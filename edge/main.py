#!/usr/bin/env python3
"""Aura Watch edge agent — motion-triggered clips with post-record YOLO + ReID."""

from __future__ import annotations

import os
from dotenv import load_dotenv
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

import base64
import json
import platform
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from config import DeviceRuntimeConfig, default_stream_tracking_enabled, rtsp_local_addr_value, rtsp_transport_value

import requests
import websocket

from agent_log import AgentLogger
from camera import CameraCapture
from clip_processor import process_clip
from pipeline import PipelineSettings, VisionPipeline, encode_preview_jpeg
from recorder import (
    ClipEncoder,
    clip_meets_upload_threshold,
    get_video_duration_seconds,
    kill_ffmpeg_for_path,
    subsample_frames,
    upload_clip,
)
from device_defaults import stream_config_defaults
from reid_embedder import ReidEmbedder
from rtsp_scanner import scan_rtsp_cameras
from yolo_tracker import YoloByteTracker, class_names_from_flags, parse_class_names

_STREAM_DEFAULTS = stream_config_defaults()
_DEFAULT_RUNTIME = DeviceRuntimeConfig()


def derive_ws_url(http_url: str) -> str:
    url = http_url.rstrip("/")
    if url.startswith("https://"):
        return "wss://" + url[len("https://") :]
    if url.startswith("http://"):
        return "ws://" + url[len("http://") :]
    return "wss://aura-watch.adboardtools.com"


CLOUD_URL = os.getenv("CLOUD_URL", "https://aura-watch.adboardtools.com").rstrip("/")
CLOUD_WS_URL = derive_ws_url(CLOUD_URL)
DEVICE_NAME = os.getenv("DEVICE_NAME", "Office Edge Device")
LOCAL_VIDEO_DIR = os.getenv("LOCAL_VIDEO_DIR", os.path.join(BASE_DIR, "storage", "temp_clips"))
LOCAL_CROPS_DIR = os.getenv("LOCAL_CROPS_DIR", os.path.join(BASE_DIR, "storage", "crops"))
LOCAL_CLIPS_DIR = os.path.join(BASE_DIR, "storage", "clips")
DEVICE_ID_FILE = os.path.join(BASE_DIR, ".device-id")
AGENT_LOG_FILE = os.path.join(BASE_DIR, "storage", "agent.log")
WORKER_LOG_FILE = os.path.join(BASE_DIR, "storage", "worker.log")
HEALTH_HEARTBEAT_SEC = max(60, int(os.getenv("HEALTH_HEARTBEAT_SEC", "300")))
DEBUG_LOGS = _DEFAULT_RUNTIME.debug_logs
PREVIEW_STALL_TIMEOUT_SEC = _DEFAULT_RUNTIME.preview_stall_timeout_sec
STREAM_FILE_CHUNK_BYTES = max(64 * 1024, int(os.getenv("STREAM_FILE_CHUNK_BYTES", str(256 * 1024))))
AUTO_UPDATE_ON_BOOT = os.getenv("AUTO_UPDATE_ON_BOOT", "true").strip().lower() not in ("0", "false", "no")


def _read_proc_meminfo() -> dict[str, int]:
    info: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, value = line.split(":", 1)
                info[key.strip()] = int(value.strip().split()[0]) * 1024
    except OSError:
        pass
    return info


def _cpu_usage_percent(interval: float = 0.15) -> float | None:
    try:
        def snapshot() -> tuple[int, int]:
            with open("/proc/stat", encoding="utf-8") as handle:
                parts = handle.readline().split()[1:]
            values = [int(part) for part in parts]
            idle = values[3] + (values[4] if len(values) > 4 else 0)
            return idle, sum(values)

        idle1, total1 = snapshot()
        time.sleep(interval)
        idle2, total2 = snapshot()
        delta_total = total2 - total1
        if delta_total <= 0:
            return None
        return round(100.0 * (1.0 - (idle2 - idle1) / delta_total), 1)
    except OSError:
        return None


def collect_system_metrics() -> dict[str, Any]:
    mem = _read_proc_meminfo()
    mem_total = mem.get("MemTotal", 0)
    mem_available = mem.get("MemAvailable", mem.get("MemFree", 0))
    mem_used = max(0, mem_total - mem_available)

    swap_total = mem.get("SwapTotal", 0)
    swap_free = mem.get("SwapFree", 0)
    swap_used = max(0, swap_total - swap_free)

    disk = shutil.disk_usage("/")

    uptime_sec: float | None = None
    try:
        with open("/proc/uptime", encoding="utf-8") as handle:
            uptime_sec = float(handle.readline().split()[0])
    except OSError:
        pass

    load_avg: list[float] | None = None
    try:
        load_avg = [round(value, 2) for value in os.getloadavg()]
    except (OSError, AttributeError):
        pass

    metrics: dict[str, Any] = {
        "hostname": platform.node(),
        "platform": platform.platform(),
        "cpu_percent": _cpu_usage_percent(),
        "cpu_count": os.cpu_count() or 1,
        "load_avg": load_avg,
        "memory_total_bytes": mem_total,
        "memory_used_bytes": mem_used,
        "memory_available_bytes": mem_available,
        "swap_total_bytes": swap_total,
        "swap_used_bytes": swap_used,
        "disk_total_bytes": disk.total,
        "disk_used_bytes": disk.used,
        "disk_free_bytes": disk.free,
        "uptime_seconds": uptime_sec,
        "timestamp": time.time(),
    }
    metrics.update(_tailscale_metrics())
    return metrics


def _tailscale_metrics() -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return {}
        data = json.loads(result.stdout)
        self_info = data.get("Self") or {}
        ips = self_info.get("TailscaleIPs") or []
        tailscale_ip = next((ip for ip in ips if ":" not in str(ip)), ips[0] if ips else None)
        dns_name = str(self_info.get("DNSName") or "").rstrip(".")
        return {
            "tailscale_ip": tailscale_ip,
            "tailscale_hostname": dns_name or None,
            "tailscale_online": data.get("BackendState") == "Running",
        }
    except Exception:
        return {}


@dataclass
class EdgeConfig:
    name: str = DEVICE_NAME
    camera_type: str = "webcam"
    stream_url: str = "0"
    tracking_enabled: bool = field(default_factory=lambda: bool(_STREAM_DEFAULTS["trackingEnabled"]))
    motion_threshold: int = field(default_factory=lambda: int(_STREAM_DEFAULTS["motionThreshold"]))
    pixel_change_threshold: float = field(
        default_factory=lambda: float(_STREAM_DEFAULTS["pixelChangeThreshold"])
    )
    detect_person: bool = field(default_factory=lambda: bool(_STREAM_DEFAULTS["detectPerson"]))
    detect_vehicle: bool = field(default_factory=lambda: bool(_STREAM_DEFAULTS["detectVehicle"]))

    def runtime(self, device: DeviceRuntimeConfig) -> DeviceRuntimeConfig:
        return device

    def detection_classes(self) -> list[str]:
        classes = class_names_from_flags(self.detect_person, self.detect_vehicle)
        if classes:
            return classes
        return parse_class_names(os.getenv("YOLO_CLASSES", "person,vehicle"))


@dataclass
class ClipProcessingJob:
    stream_id: str
    output_path: str
    filename: str
    timestamp_ms: int
    width: int
    height: int
    actual_duration: float
    clip_fps: int
    preroll_frame_count: int


class EdgeAgent:
    def __init__(self):
        self.device_id = self._load_or_create_device_id()
        self.ws: Optional[websocket.WebSocketApp] = None
        self.ws_thread: Optional[threading.Thread] = None
        self.heartbeat_timer: Optional[threading.Timer] = None
        self.preview_stall_timer: Optional[threading.Timer] = None
        self.health_heartbeat_timer: Optional[threading.Timer] = None
        self.reconnect_timer: Optional[threading.Timer] = None
        self.ws_lock = threading.Lock()
        self.shutdown_event = threading.Event()
        self.agent_logger = AgentLogger(AGENT_LOG_FILE)

        # Multi-stream configurations and pipelines
        self.device_runtime_config = DeviceRuntimeConfig()
        self.streams_config: dict[str, EdgeConfig] = {}
        self.pipelines: dict[str, dict[str, Any]] = {}
        self._recent_logs: list[tuple[str, str]] = []
        self._clip_job_queue: queue.Queue[ClipProcessingJob] = queue.Queue()
        self._clip_jobs_lock = threading.Lock()
        self._clip_jobs_pending: dict[str, int] = {}
        self.reid_embedder = ReidEmbedder()
        reid_error = self.reid_embedder.validate()
        if reid_error:
            print(f"[ReID] WARNING: {reid_error}", flush=True)
        else:
            print(f"[ReID] OSNet ready at {self.reid_embedder.model_path}", flush=True)

        if not self.live_preview_enabled:
            print(
                "[Edge] Live preview disabled (config/edge-device-defaults.json). "
                "Hub file/status commands still active.",
                flush=True,
            )

        os.makedirs(LOCAL_VIDEO_DIR, exist_ok=True)
        os.makedirs(LOCAL_CLIPS_DIR, exist_ok=True)
        os.makedirs(os.path.join(BASE_DIR, "storage"), exist_ok=True)

        self.worker_proc = None
        self._start_clip_worker()
        
        self._status_poll_thread = threading.Thread(
            target=self._status_polling_loop,
            name="status-poll",
            daemon=True,
        )
        self._status_poll_thread.start()

    @property
    def live_preview_enabled(self) -> bool:
        return bool(self.device_runtime_config.live_preview_enabled)

    def _load_or_create_device_id(self) -> str:
        if os.path.exists(DEVICE_ID_FILE):
            with open(DEVICE_ID_FILE, "r", encoding="utf-8") as handle:
                device_id = handle.read().strip()
            print(f"[Edge] Loaded persistent device ID: {device_id}", flush=True)
            return device_id

        import secrets

        device_id = "edge_" + secrets.token_hex(8)
        with open(DEVICE_ID_FILE, "w", encoding="utf-8") as handle:
            handle.write(device_id)
        print(f"[Edge] Generated and saved new device ID: {device_id}", flush=True)
        return device_id

    def send_log(self, message: str):
        timestamp = self.agent_logger.write(message, tag="Edge Log")
        self._recent_logs.append((message, timestamp))
        if len(self._recent_logs) > 100:
            self._recent_logs = self._recent_logs[-100:]
        self._ws_send({"type": "log", "message": message, "timestamp": timestamp})

    def send_device_event(
        self,
        *,
        category: str,
        severity: str,
        event_type: str,
        message: str,
        detail: dict[str, Any] | None = None,
        stream_id: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "category": category,
            "severity": severity,
            "eventType": event_type,
            "message": message,
        }
        if detail:
            payload["detail"] = detail
        if stream_id:
            payload["streamId"] = stream_id

        if self.ws:
            self._ws_send({"type": "device_event", **payload})
            return

        try:
            url = f"{CLOUD_URL.rstrip('/')}/api/devices/{self.device_id}/report-event"
            response = requests.post(url, json=payload, timeout=15)
            if response.status_code >= 400:
                print(
                    f"[Edge] Device event report failed ({response.status_code}): {response.text[:200]}",
                    flush=True,
                )
        except Exception as exc:
            print(f"[Edge] Failed to report device event: {exc}", flush=True)

    def _replay_recent_logs(self, limit: int = 25) -> None:
        for message, timestamp in self._recent_logs[-limit:]:
            self._ws_send({"type": "log", "message": message, "timestamp": timestamp})

    def send_status(self, stream_id: str, status: str):
        self._ws_send({"type": "status_change", "streamId": stream_id, "status": status})

    def _classify_camera_error(self, detail: str) -> str:
        lower = detail.lower()
        if "no route to host" in lower or "network is unreachable" in lower:
            return "camera_unreachable"
        if "timed out" in lower or "timeout" in lower:
            return "camera_timeout"
        if "connection refused" in lower:
            return "camera_refused"
        if "401" in lower or "403" in lower or "unauthorized" in lower:
            return "camera_auth"
        if "stream lost" in lower or "no frame" in lower:
            return "camera_stall"
        return "camera_error"

    def _simplify_camera_error(self, detail: str) -> str:
        cleaned = detail.replace("\n", " ").strip()
        if len(cleaned) > 220:
            return f"{cleaned[:217]}..."
        return cleaned or "Camera connection failed"

    def send_stream_error(
        self,
        stream_id: str,
        *,
        error_type: str,
        message: str,
        retry_in_sec: float | None = None,
    ):
        payload: dict[str, Any] = {
            "type": "stream_error",
            "streamId": stream_id,
            "errorType": error_type,
            "message": message,
        }
        if retry_in_sec is not None:
            payload["retryInSec"] = round(retry_in_sec, 1)
        self._ws_send(payload)

    def send_stream_error_cleared(self, stream_id: str):
        p_data = self.pipelines.get(stream_id)
        if p_data is not None:
            p_data["stream_in_error"] = False
        self._ws_send({"type": "stream_error_cleared", "streamId": stream_id})

    def _mark_stream_error(self, stream_id: str) -> None:
        p_data = self.pipelines.get(stream_id)
        if p_data is not None:
            p_data["stream_in_error"] = True

    def _increment_clip_jobs(self, stream_id: str) -> None:
        pass

    def _decrement_clip_jobs(self, stream_id: str) -> None:
        pass

    def _clip_jobs_active(self, stream_id: str) -> bool:
        try:
            for filename in os.listdir(LOCAL_VIDEO_DIR):
                if filename.endswith(".json"):
                    if f"_{stream_id}.json" in filename:
                        return True
        except Exception:
            pass
        return False

    def _resolve_stream_status(self, stream_id: str) -> str:
        p_data = self.pipelines.get(stream_id)
        config = self.streams_config.get(stream_id)
        if not p_data or p_data["stop_event"].is_set():
            return "Offline"
        if p_data.get("is_recording"):
            return "Recording"
        if self._clip_jobs_active(stream_id):
            return "Processing"
        if p_data.get("stream_in_error"):
            return "Error"
        camera = p_data.get("camera")
        if camera and camera.is_opened():
            return "Monitoring" if (config and config.tracking_enabled) else "Idle"
        return "Error" if p_data.get("stream_in_error") else "Idle"

    def _restore_stream_status(self, stream_id: str) -> None:
        if self.pipelines.get(stream_id):
            self.send_status(stream_id, self._resolve_stream_status(stream_id))

    def _start_clip_worker(self) -> None:
        worker_script = os.path.join(BASE_DIR, "clip_worker.py")
        
        def run_worker_loop():
            while not self.shutdown_event.is_set():
                self.send_log("Starting background clip processing worker...")
                try:
                    worker_env = os.environ.copy()
                    worker_env["WORKER_LOG_FILE"] = WORKER_LOG_FILE
                    self.worker_proc = subprocess.Popen(
                        [sys.executable, "-u", worker_script],
                        cwd=BASE_DIR,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        bufsize=1,
                        env=worker_env,
                    )
                    
                    # Read stdout line by line
                    for line in iter(self.worker_proc.stdout.readline, ""):
                        if self.shutdown_event.is_set():
                            break
                        line_str = line.strip()
                        if line_str:
                            self.send_log(line_str)
                            
                    self.worker_proc.wait()
                except Exception as exc:
                    self.send_log(f"[Agent] Worker process error: {exc}")
                
                if not self.shutdown_event.is_set():
                    self.send_log("Worker process stopped. Restarting in 5s...")
                    time.sleep(5)
                    
        threading.Thread(target=run_worker_loop, name="worker-monitor", daemon=True).start()

    def _status_polling_loop(self) -> None:
        last_pending = {}
        while not self.shutdown_event.is_set():
            time.sleep(2.0)
            for stream_id in list(self.pipelines.keys()):
                is_active = self._clip_jobs_active(stream_id)
                if is_active != last_pending.get(stream_id, False):
                    last_pending[stream_id] = is_active
                    self._restore_stream_status(stream_id)

    def _apply_hub_configure(
        self,
        device_config: Optional[dict[str, Any]],
        streams_data: list[dict[str, Any]],
    ) -> None:
        try:
            if device_config is not None:
                self.update_device_config(device_config)
            self.send_log(f"Applying updated configuration with {len(streams_data)} stream(s).")
            self.update_streams_config(streams_data)
        except Exception as exc:
            self.send_log(f"[Hub] Failed to apply configuration: {exc}")

    def _stop_active_clip_encoder(self, p_data: dict[str, Any]) -> Optional[ClipEncoder]:
        with p_data["clip_encoder_lock"]:
            encoder = p_data.get("clip_encoder")
            p_data["clip_encoder"] = None
        if encoder:
            encoder.stop()
        return encoder

    def _ws_send(self, payload: dict[str, Any]):
        if not self.ws:
            return
        with self.ws_lock:
            try:
                self.ws.send(json.dumps(payload))
            except Exception:
                pass

    def _check_git_versions(self) -> dict[str, Optional[str]]:
        """Compare local HEAD with origin; triggered on demand from the dashboard refresh action."""
        try:
            repo_root = self._find_repo_root()
            if not os.path.isdir(os.path.join(repo_root, ".git")):
                return {"gitCommit": None, "remoteGitCommit": None}

            local_result = self._run_git(repo_root, ["rev-parse", "HEAD"], timeout=15)
            if local_result.returncode != 0:
                return {"gitCommit": None, "remoteGitCommit": None}
            local_commit = local_result.stdout.strip()

            branch_result = self._run_git(repo_root, ["symbolic-ref", "--short", "HEAD"], timeout=15)
            if branch_result.returncode != 0:
                return {"gitCommit": local_commit, "remoteGitCommit": None}
            branch = branch_result.stdout.strip()

            fetch_result = self._run_git(repo_root, ["fetch", "origin", branch], timeout=60)
            if fetch_result.returncode != 0:
                return {"gitCommit": local_commit, "remoteGitCommit": None}

            remote_result = self._run_git(repo_root, ["rev-parse", f"origin/{branch}"], timeout=15)
            if remote_result.returncode != 0:
                return {"gitCommit": local_commit, "remoteGitCommit": None}
            remote_commit = remote_result.stdout.strip()

            return {"gitCommit": local_commit, "remoteGitCommit": remote_commit}
        except Exception as exc:
            print(f"[Edge] Git version check failed: {exc}")
            return {"gitCommit": None, "remoteGitCommit": None}

    def register_device(self) -> dict[str, Any]:
        url = f"{CLOUD_URL.rstrip('/')}/api/devices/register"
        version_info = self._check_git_versions()
        # Backwards compatible parameters if hub expects single-stream fields
        payload: dict[str, Any] = {
            "deviceId": self.device_id,
            "name": DEVICE_NAME,
            "cameraType": "webcam",
            "streamUrl": "0",
            "trackingEnabled": _STREAM_DEFAULTS["trackingEnabled"],
            "motionThreshold": _STREAM_DEFAULTS["motionThreshold"],
            "pixelChangeThreshold": _STREAM_DEFAULTS["pixelChangeThreshold"],
            "status": "Idle",
        }
        enrollment_token = os.getenv("ENROLLMENT_TOKEN", "").strip()
        if enrollment_token:
            payload["enrollmentToken"] = enrollment_token
        if version_info.get("gitCommit"):
            payload["gitCommit"] = version_info["gitCommit"]
        if version_info.get("remoteGitCommit"):
            payload["remoteGitCommit"] = version_info["remoteGitCommit"]

        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()

    def _cancel_active_recording(self, stream_id: str, reason: str = "tracking disabled") -> None:
        p_data = self.pipelines.get(stream_id)
        if not p_data:
            return

        with p_data["recording_lock"]:
            was_recording = bool(p_data.get("is_recording"))
            p_data["is_recording"] = False

        if not was_recording:
            return

        self._stop_active_clip_encoder(p_data)
        config = self.streams_config.get(stream_id)
        name = config.name if config else stream_id
        self.send_log(f"[{name}] Cancelled in-progress clip recording ({reason}).")
        self.send_status(stream_id, "Monitoring" if (config and config.tracking_enabled) else "Idle")

    def _apply_tracking_toggle(self, stream_id: str, config: EdgeConfig) -> None:
        """Apply tracking on/off without restarting the camera pipeline."""
        self.streams_config[stream_id] = config
        p_data = self.pipelines.get(stream_id)

        if not p_data:
            self.start_stream_pipeline(stream_id)
            return

        settings = p_data.get("settings")
        if settings is not None:
            settings.tracking_enabled = config.tracking_enabled

        tracker = p_data.get("tracker")
        if tracker and not config.tracking_enabled:
            tracker.reset_detection_edge()

        if not config.tracking_enabled:
            self._cancel_active_recording(stream_id)

        self.send_status(stream_id, "Monitoring" if config.tracking_enabled else "Idle")

    def update_device_config(self, device_data: Optional[dict[str, Any]]) -> None:
        new_config = DeviceRuntimeConfig.from_db(device_data)
        if new_config == self.device_runtime_config:
            return
        self.device_runtime_config = new_config
        self.send_log("Applying updated device configuration from cloud.")
        for stream_id in list(self.streams_config.keys()):
            self.restart_stream_pipeline(stream_id)

    def update_streams_config(self, streams_data: list[dict[str, Any]]):
        active_ids = set()
        for s in streams_data:
            stream_id = s.get("streamId")
            active_ids.add(stream_id)

            config = EdgeConfig(
                name=s.get("name", "Unnamed Stream"),
                camera_type=s.get("cameraType", "webcam"),
                stream_url=s.get("streamUrl", "0"),
                tracking_enabled=bool(s.get("trackingEnabled", default_stream_tracking_enabled())),
                motion_threshold=int(s.get("motionThreshold", 25)),
                pixel_change_threshold=float(s.get("pixelChangeThreshold", 0.02)),
                detect_person=bool(s.get("detectPerson", True)),
                detect_vehicle=bool(s.get("detectVehicle", True)),
            )

            existing = self.streams_config.get(stream_id)
            needs_restart = not existing or (
                existing.camera_type != config.camera_type
                or existing.stream_url != config.stream_url
                or existing.detect_person != config.detect_person
                or existing.detect_vehicle != config.detect_vehicle
                or existing.motion_threshold != config.motion_threshold
                or existing.pixel_change_threshold != config.pixel_change_threshold
            )
            tracking_changed = not existing or existing.tracking_enabled != config.tracking_enabled

            if needs_restart:
                self.streams_config[stream_id] = config
                if tracking_changed and not config.tracking_enabled:
                    self._cancel_active_recording(stream_id, reason="config restart")
                self.restart_stream_pipeline(stream_id)
            elif tracking_changed:
                self._apply_tracking_toggle(stream_id, config)
            else:
                self.streams_config[stream_id] = config

        # Stop streams no longer present
        for stream_id in list(self.streams_config.keys()):
            if stream_id not in active_ids:
                self.stop_stream_pipeline(stream_id)
                self.streams_config.pop(stream_id)

    def start_stream_pipeline(self, stream_id: str):
        self.stop_stream_pipeline(stream_id)

        config = self.streams_config.get(stream_id)
        if not config:
            return

        stop_event = threading.Event()
        pipeline_data = {
            "stop_event": stop_event,
            "is_recording": False,
            "recording_thread": None,
            "recording_cooldown_until": 0.0,
            "last_motion_at": 0.0,
            "recording_lock": threading.Lock(),
            "motion_lock": threading.Lock(),
            "clip_encoder_lock": threading.Lock(),
            "clip_encoder": None,
            "preroll_frames": [],
            "frame_width": 0,
            "frame_height": 0,
            "stream_frames": False,
            "last_preview_sent_at": 0.0,
            "preview_stalled": False,
            "recording_started_at_mono": None,
            "recording_started_at_ms": None,
            "tracker": None,
            "stream_in_error": False,
        }
        self.pipelines[stream_id] = pipeline_data

        thread = threading.Thread(
            target=self._stream_pipeline_loop,
            args=(stream_id, stop_event),
            name=f"pipeline-{stream_id}",
            daemon=True,
        )
        pipeline_data["thread"] = thread
        thread.start()

        self.send_status(stream_id, "Monitoring" if config.tracking_enabled else "Idle")

    def stop_stream_pipeline(self, stream_id: str, *, notify_offline: bool = True):
        pipeline_data = self.pipelines.pop(stream_id, None)
        if not pipeline_data:
            return

        pipeline_data["stop_event"].set()
        with pipeline_data["recording_lock"]:
            pipeline_data["is_recording"] = False
        self._stop_active_clip_encoder(pipeline_data)
        thread = pipeline_data.get("thread")
        if thread and thread.is_alive():
            thread.join(timeout=10)
        if notify_offline:
            self.send_status(stream_id, "Offline")

    def restart_stream_pipeline(self, stream_id: str):
        config = self.streams_config.get(stream_id)
        name = config.name if config else stream_id
        existing = self.pipelines.get(stream_id)
        was_streaming_preview = bool(existing and existing.get("stream_frames"))
        self.send_log(f"Restarting stream pipeline to apply new configuration for: {name}")
        self.stop_stream_pipeline(stream_id, notify_offline=False)
        self.start_stream_pipeline(stream_id)
        if was_streaming_preview and self.live_preview_enabled:
            p_data = self.pipelines.get(stream_id)
            if p_data:
                p_data["stream_frames"] = True
                p_data["last_preview_sent_at"] = 0.0
                p_data["preview_stalled"] = False

    def _schedule_health_heartbeat(self):
        if self.shutdown_event.is_set():
            return
        self._emit_health_heartbeat()
        self.health_heartbeat_timer = threading.Timer(
            float(HEALTH_HEARTBEAT_SEC),
            self._schedule_health_heartbeat,
        )
        self.health_heartbeat_timer.daemon = True
        self.health_heartbeat_timer.start()

    def _emit_health_heartbeat(self):
        stream_states: list[str] = []
        for stream_id, p_data in self.pipelines.items():
            config = self.streams_config.get(stream_id)
            name = config.name if config else stream_id
            camera = p_data.get("camera")
            camera_ok = bool(camera and camera.is_opened())
            preview_on = bool(p_data.get("stream_frames"))
            recording = bool(p_data.get("is_recording"))
            parts = [name, "camera=up" if camera_ok else "camera=down"]
            if preview_on:
                parts.append("preview=on")
            if recording:
                parts.append("recording")
            stream_states.append("/".join(parts))

        ws_ok = bool(self.ws)
        cpu_usage = _cpu_usage_percent(interval=0.1)
        cpu_str = f"cpu={cpu_usage}%" if cpu_usage is not None else "cpu=N/A"
        q_len = self._clip_job_queue.qsize()
        self.send_log(
            "[Health] "
            f"pid={os.getpid()} "
            f"ws={'up' if ws_ok else 'down'} "
            f"streams={len(self.pipelines)} "
            f"{cpu_str} queue_len={q_len} "
            f"[{'; '.join(stream_states) or 'none'}]"
        )

    def _kill_stale_rtsp_ffmpeg(self, stream_url: str) -> None:
        if not stream_url.lower().startswith("rtsp"):
            return
        try:
            from urllib.parse import urlparse

            host = urlparse(stream_url).hostname or ""
            if not host:
                return
            subprocess.run(
                ["pkill", "-f", f"ffmpeg.*{host}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        except Exception:
            pass

    def _run_continuous_rtsp_push(self, stream_id: str, stream_url: str, remote_url: str, stop_event: threading.Event):
        self.send_log(f"[Pusher] Starting continuous RTSP stream copy to {remote_url}")
        transport = rtsp_transport_value()
        
        while not stop_event.is_set() and not self.shutdown_event.is_set():
            args = ["ffmpeg", "-y", "-loglevel", "error"]
            if transport in ("tcp", "udp"):
                args += ["-rtsp_transport", transport]
            
            args += [
                "-i", stream_url,
                "-c", "copy",
                "-an",
                "-f", "rtsp",
                "-rtsp_transport", "tcp",
                remote_url
            ]
            
            try:
                proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                while proc.poll() is None:
                    if stop_event.is_set() or self.shutdown_event.is_set():
                        proc.terminate()
                        try:
                            proc.wait(timeout=2)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait(timeout=2)
                        break
                    time.sleep(1)
                
                if not stop_event.is_set() and not self.shutdown_event.is_set():
                    stderr_data = ""
                    if proc.stderr:
                        try:
                            stderr_data = proc.stderr.read().decode('utf-8', errors='ignore').strip()
                        except Exception:
                            pass
                    err_suffix = f": {stderr_data}" if stderr_data else ""
                    self.send_log(f"[Pusher] Continuous RTSP stream copy exited with code {proc.returncode}{err_suffix}. Restarting in 5s...")
                    
            except Exception as e:
                self.send_log(f"[Pusher] Continuous RTSP stream copy failed to start: {e}. Retry in 5s...")
                
            for _ in range(25):
                if stop_event.is_set() or self.shutdown_event.is_set():
                    break
                time.sleep(0.2)

    def _stream_pipeline_loop(self, stream_id: str, stop_event: threading.Event):
        retry_delay = 10.0
        consecutive_failures = 0

        while not stop_event.is_set() and not self.shutdown_event.is_set():
            config = self.streams_config.get(stream_id)
            if not config:
                break

            runtime = config.runtime(self.device_runtime_config)
            self._kill_stale_rtsp_ffmpeg(config.stream_url)
            camera = CameraCapture(
                camera_type=config.camera_type,
                stream_url=config.stream_url,
                width=runtime.camera_width,
                height=runtime.camera_height,
                fps=runtime.camera_fps,
                rtsp_transport=rtsp_transport_value(),
                rtsp_local_addr=rtsp_local_addr_value(),
            )
            if not camera.open():
                consecutive_failures += 1
                detail = camera.last_error or "unknown error"
                self.send_log(
                    f"[{config.name}] Failed to open camera ({detail}). "
                    f"Retrying in {int(retry_delay)}s..."
                )
                self.send_stream_error(
                    stream_id,
                    error_type=self._classify_camera_error(detail),
                    message=self._simplify_camera_error(detail),
                    retry_in_sec=retry_delay,
                )
                self._mark_stream_error(stream_id)
                self.send_status(stream_id, "Error")
                if self._wait_stream(stop_event, retry_delay):
                    break
                retry_delay = min(retry_delay * 1.5, 60.0)
                continue

            frame_ok = False
            for _ in range(30):
                probe = camera.read()
                if probe is not None:
                    frame_ok = True
                    break
                time.sleep(0.1)
            if not frame_ok:
                detail = camera.last_error or "camera.read() returned None"
                self.send_log(
                    f"[{config.name}] Camera opened but no frames ({detail}). "
                    f"Retrying in {int(retry_delay)}s..."
                )
                self.send_stream_error(
                    stream_id,
                    error_type="camera_no_frames",
                    message=self._simplify_camera_error(detail),
                    retry_in_sec=retry_delay,
                )
                self._mark_stream_error(stream_id)
                camera.release()
                self.send_status(stream_id, "Error")
                if self._wait_stream(stop_event, retry_delay):
                    break
                retry_delay = min(retry_delay * 1.5, 60.0)
                continue

            retry_delay = 10.0
            consecutive_failures = 0
            self.send_stream_error_cleared(stream_id)
            detection_classes = config.detection_classes()

            pipeline_data = self.pipelines.get(stream_id)
            if not pipeline_data:
                camera.release()
                break

            pipeline_data["camera"] = camera
            pipeline_data["frame_width"] = camera.width
            pipeline_data["frame_height"] = camera.height
            pipeline_data["detection_classes"] = detection_classes

            self.send_log(
                f"[{config.name}] Motion watch active ({camera.width}x{camera.height}) | "
                f"targets={', '.join(detection_classes)} when clips are processed"
            )
            if pipeline_data.get("stream_frames") and self.live_preview_enabled:
                self.send_log(f"[{config.name}] Live preview streaming enabled (no live YOLO).")
            self.send_status(stream_id, "Monitoring" if config.tracking_enabled else "Idle")

            settings = PipelineSettings(
                clip_fps=runtime.camera_fps,
                stream_fps=runtime.frame_stream_fps,
                jpeg_quality=runtime.preview_jpeg_quality,
                tracking_enabled=config.tracking_enabled,
                camera_stall_timeout_sec=runtime.camera_stall_timeout_sec,
                motion_threshold=config.motion_threshold,
                pixel_change_threshold=config.pixel_change_threshold,
                preroll_sec=runtime.clip_preroll_sec,
                yolo_detect_interval=getattr(runtime, "yolo_detect_interval", 1),
            )
            pipeline_data["settings"] = settings
            pipeline_data["runtime"] = runtime

            def get_clip_encoder() -> Optional[ClipEncoder]:
                p_data = self.pipelines.get(stream_id)
                if not p_data or not p_data.get("is_recording"):
                    return None
                with p_data["clip_encoder_lock"]:
                    return p_data.get("clip_encoder")

            def on_preview(frame):
                if not self.live_preview_enabled:
                    return
                p_data = self.pipelines.get(stream_id)
                if p_data and p_data.get("stream_frames", False):
                    self._send_preview_frame(stream_id, frame, settings.jpeg_quality)

            def on_motion_start(ratio: float, get_preroll_frames: Callable[[], list]):
                p_data = self.pipelines.get(stream_id)
                if not p_data:
                    return
                live_config = self.streams_config.get(stream_id)
                if not live_config or not live_config.tracking_enabled:
                    return
                with p_data["motion_lock"]:
                    p_data["last_motion_at"] = time.monotonic()
                if not self._try_start_clip_recording(stream_id, ratio, get_preroll_frames):
                    return

            def on_motion_active():
                p_data = self.pipelines.get(stream_id)
                if not p_data:
                    return
                with p_data["motion_lock"]:
                    p_data["last_motion_at"] = time.monotonic()

            tracker = self._get_stream_tracker(stream_id)
            pipeline = VisionPipeline(
                camera=camera,
                settings=settings,
                tracker=tracker,
                get_clip_encoder=get_clip_encoder,
                on_preview_frame=on_preview if self.live_preview_enabled else None,
                on_motion_start=on_motion_start,
                on_motion_active=on_motion_active,
                should_stop=lambda: stop_event.is_set() or self.shutdown_event.is_set(),
            )
            pipeline_data["pipeline"] = pipeline

            try:
                pipeline.start_capture()
                
                global_remote_url = os.getenv("REMOTE_STREAM_URL", "").strip() or "rtsp://mediamtx.adboardtools.com:8554/live"
                if global_remote_url:
                    pusher_stop_event = threading.Event()
                    if global_remote_url.endswith("/"):
                        remote_url = f"{global_remote_url}{stream_id}"
                    elif "/" not in global_remote_url.split("://", 1)[-1]:
                        remote_url = f"{global_remote_url}/{stream_id}"
                    else:
                        remote_url = f"{global_remote_url}_{stream_id}"
                    
                    # Check if the camera stream is already on the target MediaMTX host to avoid redundancy/feedback loops
                    is_same_server = False
                    try:
                        from urllib.parse import urlparse
                        stream_host = urlparse(config.stream_url).hostname
                        remote_host = urlparse(remote_url).hostname
                        if stream_host and remote_host and stream_host.lower() == remote_host.lower():
                            is_same_server = True
                    except Exception:
                        pass

                    if is_same_server:
                        self.send_log(f"[{config.name}] Stream URL is already on the target MediaMTX server ({stream_host}). Skipping continuous push.")
                    else:
                        if config.camera_type == "rtsp":
                            t = threading.Thread(
                                target=self._run_continuous_rtsp_push,
                                args=(stream_id, config.stream_url, remote_url, pusher_stop_event),
                                name=f"pusher-{stream_id}",
                                daemon=True
                            )
                            pipeline_data["pusher_thread"] = t
                            pipeline_data["pusher_stop_event"] = pusher_stop_event
                            t.start()
                        else:
                            self.send_log(f"[{config.name}] Starting continuous webcam transcode push to {remote_url} (CPU intensive)")
                            continuous_encoder = ClipEncoder(
                                output_path="",
                                width=camera.width,
                                height=camera.height,
                                fps=runtime.camera_fps,
                                remote_stream_url=remote_url,
                                only_remote=True
                            )
                            continuous_encoder.start()
                            pipeline_data["continuous_encoder"] = continuous_encoder
                            pipeline.start_continuous_feed(continuous_encoder)

                pipeline.run()
            except Exception as exc:
                detail = str(exc)
                self.send_log(f"[{config.name}] [Pipeline Error] {detail}. Reconnecting...")
                self.send_stream_error(
                    stream_id,
                    error_type=self._classify_camera_error(detail),
                    message=self._simplify_camera_error(detail),
                    retry_in_sec=retry_delay,
                )
                self._mark_stream_error(stream_id)
                self.send_status(stream_id, "Error")
            finally:
                pusher_stop = pipeline_data.pop("pusher_stop_event", None)
                if pusher_stop:
                    pusher_stop.set()
                pusher_thread = pipeline_data.pop("pusher_thread", None)
                if pusher_thread and pusher_thread.is_alive():
                    pusher_thread.join(timeout=3.0)
                    
                continuous_encoder = pipeline_data.pop("continuous_encoder", None)
                if continuous_encoder:
                    pipeline.stop_continuous_feed()
                    continuous_encoder.stop()

                pipeline_data.pop("pipeline", None)
                pipeline.join_capture()
                self._stop_active_clip_encoder(pipeline_data)
                camera.release()
                tracker = pipeline_data.get("tracker")
                if tracker:
                    tracker.reset()

            if stop_event.is_set() or self.shutdown_event.is_set():
                break

            self.send_status(stream_id, "Error")
            if self._wait_stream(stop_event, retry_delay):
                break

    def _wait_stream(self, stop_event: threading.Event, seconds: float) -> bool:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if stop_event.is_set() or self.shutdown_event.is_set():
                return True
            time.sleep(0.25)
        return False

    def _send_preview_frame(self, stream_id: str, frame, quality: int):
        if not self.live_preview_enabled:
            return
        jpeg = encode_preview_jpeg(frame, quality)
        if not jpeg:
            return
        encoded = base64.b64encode(jpeg).decode("ascii")
        p_data = self.pipelines.get(stream_id)
        if p_data:
            p_data["last_preview_sent_at"] = time.monotonic()
            if p_data.get("preview_stalled"):
                p_data["preview_stalled"] = False
                self._ws_send({"type": "preview_resumed", "streamId": stream_id})
        self._ws_send({"type": "frame", "streamId": stream_id, "image": encoded})

    def _check_preview_stalls(self):
        if not self.live_preview_enabled:
            return
        now = time.monotonic()
        for stream_id, p_data in self.pipelines.items():
            if not p_data.get("stream_frames"):
                if p_data.get("preview_stalled"):
                    p_data["preview_stalled"] = False
                    self._ws_send({"type": "preview_resumed", "streamId": stream_id})
                continue

            last_sent = p_data.get("last_preview_sent_at", 0.0)
            if last_sent <= 0.0:
                continue

            stalled_for = now - last_sent
            runtime = p_data.get("runtime")
            stall_timeout = (
                runtime.preview_stall_timeout_sec
                if runtime is not None
                else PREVIEW_STALL_TIMEOUT_SEC
            )
            if stalled_for >= stall_timeout:
                if not p_data.get("preview_stalled"):
                    p_data["preview_stalled"] = True
                    self._ws_send(
                        {
                            "type": "preview_stall",
                            "streamId": stream_id,
                            "stalledForSec": round(stalled_for, 1),
                        }
                    )
            elif p_data.get("preview_stalled"):
                p_data["preview_stalled"] = False
                self._ws_send({"type": "preview_resumed", "streamId": stream_id})

    def _get_stream_tracker(self, stream_id: str) -> YoloByteTracker:
        p_data = self.pipelines.get(stream_id)
        if not p_data:
            raise RuntimeError(f"No pipeline data for stream {stream_id}")

        existing = p_data.get("tracker")
        if existing is not None:
            return existing

        config = self.streams_config.get(stream_id)
        runtime = p_data.get("runtime")
        if runtime is None and config is not None:
            runtime = config.runtime(self.device_runtime_config)
        if runtime is None:
            runtime = _DEFAULT_RUNTIME

        detection_classes = p_data.get("detection_classes")
        if not detection_classes and config is not None:
            detection_classes = config.detection_classes()

        tracker = YoloByteTracker(
            confidence=runtime.yolo_confidence,
            device=runtime.yolo_device,
            class_names=detection_classes,
            imgsz=runtime.yolo_imgsz,
            reid_confidence_threshold=runtime.reid_confidence_threshold,
            reid_min_bbox_size=runtime.reid_min_bbox_size,
            reid_visible_sec=runtime.reid_visible_sec,
        )
        p_data["tracker"] = tracker
        return tracker

    def _try_start_clip_recording(
        self,
        stream_id: str,
        motion_ratio: float,
        get_preroll_frames: Callable[[], list],
    ) -> bool:
        p_data = self.pipelines.get(stream_id)
        if not p_data:
            return False

        config = self.streams_config.get(stream_id)
        name = config.name if config else stream_id

        with p_data["recording_lock"]:
            if p_data["is_recording"]:
                return False
            if p_data["recording_thread"] and p_data["recording_thread"].is_alive():
                last_log = p_data.get("last_skip_log_time", 0.0)
                now = time.monotonic()
                if now - last_log > 5.0:
                    p_data["last_skip_log_time"] = now
                    self.send_log(
                        f"[{name}] Cannot start clip recording: previous recording thread is still alive (finishing/cleaning up)."
                    )
                return False
            cooldown_left = p_data["recording_cooldown_until"] - time.monotonic()
            if cooldown_left > 0:
                last_log = p_data.get("last_skip_log_time", 0.0)
                now = time.monotonic()
                if now - last_log > 5.0:
                    p_data["last_skip_log_time"] = now
                    self.send_log(
                        f"[{name}] Cannot start clip recording: in cooldown for another {cooldown_left:.1f}s."
                    )
                return False

            preroll_frames = get_preroll_frames()
            p_data["is_recording"] = True
            p_data["last_motion_at"] = time.monotonic()
            p_data["recording_started_at_mono"] = time.monotonic()
            p_data["recording_started_at_ms"] = int(time.time() * 1000)
            p_data["preroll_frames"] = list(preroll_frames)

        self.send_log(
            f"[{name}] Motion detected ({motion_ratio * 100:.1f}% change). "
            f"Starting clip with {len(preroll_frames)} pre-roll frame(s)..."
        )

        thread = threading.Thread(
            target=self._run_clip_recording,
            args=(stream_id,),
            daemon=True,
        )
        p_data["recording_thread"] = thread
        thread.start()
        return True

    def _run_clip_recording(self, stream_id: str):
        self.send_status(stream_id, "Recording")
        p_data = self.pipelines.get(stream_id)
        if not p_data:
            return

        config = self.streams_config.get(stream_id)
        name = config.name if config else stream_id
        runtime = p_data.get("runtime")
        if runtime is None and config is not None:
            runtime = config.runtime(self.device_runtime_config)
        recording_max_sec = runtime.recording_max_sec if runtime else _DEFAULT_RUNTIME.recording_max_sec
        recording_end_grace_sec = runtime.recording_end_grace_sec if runtime else _DEFAULT_RUNTIME.recording_end_grace_sec
        recording_cooldown_sec = runtime.recording_cooldown_sec if runtime else _DEFAULT_RUNTIME.recording_cooldown_sec
        min_upload_duration_sec = runtime.min_upload_duration_sec if runtime else _DEFAULT_RUNTIME.min_upload_duration_sec
        clip_fps = runtime.camera_fps if runtime else _DEFAULT_RUNTIME.camera_fps
        clip_preroll_sec = runtime.clip_preroll_sec if runtime else _DEFAULT_RUNTIME.clip_preroll_sec

        timestamp_ms = p_data.get("recording_started_at_ms") or int(time.time() * 1000)
        p_data["recording_started_at_ms"] = timestamp_ms
        filename = f"clip_{timestamp_ms}_{stream_id}.mp4"
        output_path = os.path.join(LOCAL_CLIPS_DIR, filename)
        width = p_data.get("frame_width") or 640
        height = p_data.get("frame_height") or 480
        clip_encoder: Optional[ClipEncoder] = None
        recording_start = time.monotonic()

        self.send_log(
            f"[{name}] Recording motion event "
            f"(max {int(recording_max_sec)}s @ {clip_fps}fps)..."
        )

        try:
            global_remote_url = os.getenv("REMOTE_STREAM_URL", "").strip() or "rtsp://mediamtx.adboardtools.com:8554/live"
            remote_url = None
            if global_remote_url:
                if global_remote_url.endswith("/"):
                    remote_url = f"{global_remote_url}{stream_id}"
                elif "/" not in global_remote_url.split("://", 1)[-1]:
                    remote_url = f"{global_remote_url}/{stream_id}"
                else:
                    remote_url = f"{global_remote_url}_{stream_id}"
                
                # If the input camera stream is already on the target MediaMTX host, do not push to avoid feedback loops
                if config and config.stream_url:
                    try:
                        from urllib.parse import urlparse
                        stream_host = urlparse(config.stream_url).hostname
                        remote_host = urlparse(remote_url).hostname
                        if stream_host and remote_host and stream_host.lower() == remote_host.lower():
                            remote_url = None
                    except Exception:
                        pass

            clip_encoder = ClipEncoder(output_path, width, height, fps=clip_fps, remote_stream_url=remote_url)
            clip_encoder.start()

            preroll_frames = subsample_frames(
                list(p_data.get("preroll_frames") or []),
                max(int(clip_preroll_sec * clip_fps), 1),
            )
            preroll_written = clip_encoder.write_frames_blocking(preroll_frames)

            with p_data["clip_encoder_lock"]:
                p_data["clip_encoder"] = clip_encoder
            p_data["preroll_frames"] = []

            pipeline = p_data.get("pipeline")
            if pipeline:
                pipeline.start_clip_feed(clip_encoder)

            while not p_data["stop_event"].is_set() and not self.shutdown_event.is_set():
                with p_data["recording_lock"]:
                    if not p_data.get("is_recording"):
                        self.send_log(f"[{name}] Clip recording cancelled.")
                        break

                live_config = self.streams_config.get(stream_id)
                if not live_config or not live_config.tracking_enabled:
                    self.send_log(f"[{name}] Clip recording stopped (tracking disabled).")
                    break

                elapsed = time.monotonic() - recording_start

                with p_data["motion_lock"]:
                    last_motion_at = p_data["last_motion_at"]

                if elapsed >= recording_max_sec:
                    self.send_log(f"[{name}] Max clip length ({int(recording_max_sec)}s) reached.")
                    break

                since_motion = time.monotonic() - last_motion_at
                if since_motion >= recording_end_grace_sec:
                    self.send_log(
                        f"[{name}] No motion for {recording_end_grace_sec:.0f}s "
                        f"(recorded {elapsed:.1f}s) — finalizing clip."
                    )
                    break

                time.sleep(0.2)

            stopped_encoder = self._stop_active_clip_encoder(p_data)
            pipeline = p_data.get("pipeline")
            clip_results = None
            if pipeline:
                clip_results = pipeline.get_active_clip_results()
                pipeline.stop_clip_feed()
            if stopped_encoder:
                clip_encoder = stopped_encoder

            if not clip_encoder or clip_encoder.frames_written < 2:
                raise RuntimeError("No frames captured during recording")

            if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
                raise RuntimeError("Clip file missing or too small after encoding")

            actual_duration = get_video_duration_seconds(output_path)
            if actual_duration <= 0:
                actual_duration = clip_encoder.frames_written / clip_fps
            encoded_duration = clip_encoder.frames_written / clip_fps
            if encoded_duration > actual_duration:
                actual_duration = encoded_duration
            file_size = os.path.getsize(output_path)
            self.send_log(
                f"[{name}] Clip encoded: {filename} "
                f"({actual_duration:.1f}s, {file_size / 1024:.1f} KB)"
            )

            if not clip_meets_upload_threshold(actual_duration, min_upload_duration_sec):
                self.send_log(
                    f"[{name}] Discarding {filename}: "
                    f"duration {actual_duration:.1f}s < {min_upload_duration_sec:.1f}s"
                )
                try:
                    os.unlink(output_path)
                except OSError:
                    pass
                return

            with p_data["recording_lock"]:
                p_data["is_recording"] = False

            pre_extracted_crops = {}
            track_events = []
            if clip_results:
                track_events = clip_results["track_events"]
                best_crops = clip_results["best_crops"]
                import cv2
                for tid, (detection, offset_ms, crop_bgr) in best_crops.items():
                    crop_filename = f"clip_{timestamp_ms}_{stream_id}_crop_{tid}.jpg"
                    crop_path = os.path.join(LOCAL_VIDEO_DIR, crop_filename)
                    try:
                        cv2.imwrite(crop_path, crop_bgr)
                        pre_extracted_crops[str(tid)] = {
                            "filename": crop_filename,
                            "offset_ms": offset_ms,
                            "bbox": list(detection.bbox),
                            "confidence": detection.confidence,
                            "class_name": detection.class_name,
                        }
                    except Exception as e:
                        self.send_log(f"[{name}] Failed to save crop image for track {tid}: {e}")

            preroll_frames = list(p_data.get("preroll_frames") or [])
            self.send_log(f"[{name}] Queuing clip for background YOLO + upload: {filename}")
            
            # Immediate upload to Cloud (with real-time YOLO metadata)
            uploaded_immediately = False
            self.send_log(f"[{name}] Uploading clip to Cloud (immediate, with real-time YOLO metadata): {filename}")
            try:
                upload_clip(
                    CLOUD_URL,
                    self.device_id,
                    output_path,
                    filename,
                    duration=actual_duration,
                    stream_id=stream_id,
                    track_events=track_events,
                    frame_width=width,
                    frame_height=height,
                    clip_start_ms=timestamp_ms,
                    reid_profiles=[],
                )
                uploaded_immediately = True
                self.send_log(f"[{name}] Successfully uploaded clip to Cloud (immediate): {filename}")
            except Exception as upload_exc:
                self.send_log(f"[{name}] Failed immediate clip upload (will retry in background): {upload_exc}")

            # Resolve config values for JSON sidecar metadata
            runtime = p_data.get("runtime")
            if runtime is None and config is not None:
                runtime = config.runtime(self.device_runtime_config)
            if runtime is None:
                runtime = _DEFAULT_RUNTIME

            detection_classes = p_data.get("detection_classes")
            if not detection_classes and config is not None:
                detection_classes = config.detection_classes()
            if not detection_classes:
                detection_classes = ["person", "vehicle"]

            json_filename = filename.replace(".mp4", ".json")
            json_path = os.path.join(LOCAL_VIDEO_DIR, json_filename)
            
            metadata = {
                "stream_id": stream_id,
                "filename": filename,
                "timestamp_ms": timestamp_ms,
                "width": width,
                "height": height,
                "actual_duration": actual_duration,
                "clip_fps": clip_fps,
                "preroll_frame_count": preroll_written,
                "yolo_detect_interval": getattr(runtime, "yolo_detect_interval", 1),
                "yolo_confidence": getattr(runtime, "yolo_confidence", 0.35),
                "yolo_device": getattr(runtime, "yolo_device", "cpu"),
                "yolo_imgsz": getattr(runtime, "yolo_imgsz", 320),
                "reid_confidence_threshold": getattr(runtime, "reid_confidence_threshold", 0.70),
                "reid_min_bbox_size": getattr(runtime, "reid_min_bbox_size", 50),
                "reid_visible_sec": getattr(runtime, "reid_visible_sec", 4.0),
                "detection_classes": detection_classes,
                "min_upload_duration_sec": getattr(runtime, "min_upload_duration_sec", 3.0),
                "attempts": 0,
                "uploaded": uploaded_immediately,
                "pre_extracted_track_events": track_events,
                "pre_extracted_crops": pre_extracted_crops,
            }

            temp_json_path = json_path + ".tmp"
            try:
                with open(temp_json_path, "w", encoding="utf-8") as f:
                    json.dump(metadata, f, indent=2)
                os.rename(temp_json_path, json_path)
                self.send_log(f"[{name}] Saved sidecar metadata: {json_filename}")
                self._restore_stream_status(stream_id)
            except Exception as e:
                self.send_log(f"[{name}] Failed to save sidecar metadata: {e}")
                # Clean up the temp file so it doesn't accumulate as a 0-byte orphan
                try:
                    if os.path.exists(temp_json_path):
                        os.unlink(temp_json_path)
                except OSError:
                    pass
        except Exception as exc:
            self.send_log(f"[{name}] Clip generation failed: {exc}")
            kill_ffmpeg_for_path(output_path)
            if os.path.exists(output_path):
                try:
                    os.unlink(output_path)
                except OSError:
                    pass
        finally:
            pipeline = p_data.get("pipeline")
            if pipeline:
                pipeline.stop_clip_feed()
            self._stop_active_clip_encoder(p_data)
            with p_data["recording_lock"]:
                if p_data.get("is_recording"):
                    p_data["is_recording"] = False
                p_data["recording_cooldown_until"] = time.monotonic() + recording_cooldown_sec
            p_data["recording_started_at_mono"] = None
            p_data["recording_started_at_ms"] = None
            p_data["preroll_frames"] = []
            if recording_cooldown_sec > 0:
                self.send_log(
                    f"[{name}] Clip cooldown started ({int(recording_cooldown_sec)}s before next clip can begin)."
                )

            if self.pipelines.get(stream_id) and not self.pipelines[stream_id]["stop_event"].is_set():
                self._restore_stream_status(stream_id)



    # --- Remote device commands (cloud dashboard) ---

    def _send_command_response(self, request_id: str, success: bool, **fields: Any) -> None:
        self._ws_send(
            {
                "type": "response_device_command",
                "requestId": request_id,
                "success": success,
                **fields,
            }
        )

    def _schedule_graceful_exit(self, delay: float = 1.0) -> None:
        """Shut down cleanly so systemd restarts the agent after a remote update."""

        def _exit():
            self.shutdown()
            os._exit(0)

        threading.Timer(delay, _exit).start()

    def _find_repo_root(self) -> str:
        parent = os.path.abspath(os.path.join(BASE_DIR, ".."))
        if os.path.isdir(os.path.join(parent, ".git")):
            return parent
        if os.path.isdir(os.path.join(BASE_DIR, ".git")):
            return BASE_DIR
        return BASE_DIR

    def _run_git(self, repo_root: str, args: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def _git_force_pull(self, repo_root: str) -> tuple[bool, str]:
        branch_result = self._run_git(repo_root, ["symbolic-ref", "--short", "HEAD"], timeout=30)
        if branch_result.returncode != 0:
            detail = (branch_result.stderr or branch_result.stdout or "").strip()
            return False, detail or "Could not determine current git branch"

        branch = branch_result.stdout.strip()
        fetch_result = self._run_git(repo_root, ["fetch", "origin", branch])
        output_parts = [line for line in (fetch_result.stdout, fetch_result.stderr) if line.strip()]
        if fetch_result.returncode != 0:
            return False, "\n".join(output_parts) or "git fetch failed"

        reset_result = self._run_git(repo_root, ["reset", "--hard", f"origin/{branch}"])
        output_parts.extend(line for line in (reset_result.stdout, reset_result.stderr) if line.strip())
        if reset_result.returncode != 0:
            return False, "\n".join(output_parts) or "git reset failed"

        return True, "\n".join(output_parts)

    def _run_logged_command(self, cmd: list[str], cwd: str, timeout_sec: float) -> tuple[bool, str]:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        output_lines: list[str] = []
        start = time.monotonic()
        assert proc.stdout is not None
        while True:
            line = proc.stdout.readline()
            if line:
                message = line.rstrip()
                if message:
                    self.send_log(message)
                    output_lines.append(message)
            elif proc.poll() is not None:
                break
            elif time.monotonic() - start > timeout_sec:
                proc.kill()
                proc.wait()
                return False, "\n".join(output_lines) or f"Command timed out after {int(timeout_sec)}s"

        returncode = proc.wait()
        output = "\n".join(output_lines)
        if returncode != 0:
            return False, output or f"Command failed with exit code {returncode}"
        return True, output

    def _refresh_systemd_service(self, edge_dir: str) -> tuple[bool, str]:
        if platform.system() != "Linux":
            return True, "Skipped systemd refresh (not Linux)."

        refresh_script = os.path.join(edge_dir, "scripts", "refresh-systemd-service.sh")
        if not os.path.isfile(refresh_script):
            return False, f"refresh-systemd-service.sh not found at {refresh_script}"

        result = subprocess.run(
            ["sudo", "-n", refresh_script],
            capture_output=True,
            text=True,
            timeout=60,
        )
        output = (result.stdout or result.stderr or "").strip()
        for line in output.splitlines():
            if line.strip():
                self.send_log(line.strip())
        if result.returncode != 0:
            hint = "Run ./scripts/setup-service.sh once on the device to grant passwordless systemd refresh."
            if "password" in output.lower() or result.returncode == 1:
                return False, f"{output}\n{hint}".strip()
            return False, output or "Failed to refresh systemd service"
        return True, output or "Systemd unit refreshed."

    def _perform_service_update(self) -> tuple[bool, str, str]:
        """Pull latest code, refresh deps + systemd unit. Returns (success, summary, error)."""
        repo_root = self._find_repo_root()
        if not os.path.isdir(os.path.join(repo_root, ".git")):
            return False, "", f"No git repository found at {repo_root}. Install via install.sh first."

        self.send_log(f"Force-pulling latest code in {repo_root}...")
        pull_ok, pull_output = self._git_force_pull(repo_root)
        if not pull_ok:
            return False, pull_output, "git force pull failed"

        summary = pull_output.splitlines()[-1] if pull_output else "done"
        self.send_log(f"Force pull complete: {summary}")

        edge_dir = os.path.join(repo_root, "edge") if os.path.isdir(os.path.join(repo_root, "edge")) else repo_root
        update_output = [pull_output]

        venv_script = os.path.join(edge_dir, "scripts", "setup-venv.sh")
        if os.path.isfile(venv_script):
            self.send_log("Updating Python dependencies...")
            venv_ok, venv_output = self._run_logged_command(
                ["sh", venv_script, edge_dir, "python3"],
                cwd=edge_dir,
                timeout_sec=600,
            )
            if venv_output:
                update_output.append(venv_output)
            if not venv_ok:
                return False, "\n\n".join(update_output), "Python dependency update failed"
        else:
            self.send_log("setup-venv.sh not found; skipping dependency update.")

        self.send_log("Refreshing systemd service unit...")
        systemd_ok, systemd_output = self._refresh_systemd_service(edge_dir)
        if systemd_output:
            update_output.append(systemd_output)
        if not systemd_ok:
            return False, "\n\n".join(update_output), "Systemd service refresh failed"

        combined_output = "\n\n".join(part for part in update_output if part)
        return True, combined_output, ""

    def _report_update_started(self, trigger: str, local_commit: str | None, remote_commit: str | None) -> None:
        from_label = local_commit[:8] if local_commit else "unknown"
        to_label = remote_commit[:8] if remote_commit else "unknown"
        self.send_device_event(
            category="update",
            severity="info",
            event_type="update_started",
            message=f"Software update started ({trigger}): {from_label} → {to_label}",
            detail={
                "trigger": trigger,
                "fromCommit": local_commit,
                "toCommit": remote_commit,
            },
        )

    def _report_update_finished(
        self,
        *,
        trigger: str,
        success: bool,
        local_commit: str | None,
        remote_commit: str | None,
        error: str = "",
        output: str = "",
    ) -> None:
        from_label = local_commit[:8] if local_commit else "unknown"
        to_label = remote_commit[:8] if remote_commit else "unknown"
        if success:
            self.send_device_event(
                category="update",
                severity="info",
                event_type="update_success",
                message=f"Software update complete ({trigger}): {from_label} → {to_label}",
                detail={
                    "trigger": trigger,
                    "fromCommit": local_commit,
                    "toCommit": remote_commit,
                },
            )
            return

        detail: dict[str, Any] = {
            "trigger": trigger,
            "fromCommit": local_commit,
            "toCommit": remote_commit,
            "error": error,
        }
        if output:
            detail["output"] = output[-2000:]
        self.send_device_event(
            category="update",
            severity="error",
            event_type="update_failed",
            message=f"Software update failed ({trigger}): {error or 'unknown error'}",
            detail=detail,
        )

    def _run_update(self, request_id: str, *, trigger: str = "manual") -> None:
        def respond(success: bool, message: str = "", **extra: Any) -> None:
            self._send_command_response(request_id, success, message=message, **extra)

        version_info = self._check_git_versions()
        local_commit = version_info.get("gitCommit")
        remote_commit = version_info.get("remoteGitCommit")
        self._report_update_started(trigger, local_commit, remote_commit)

        try:
            success, output, error = self._perform_service_update()
            if not success:
                self._report_update_finished(
                    trigger=trigger,
                    success=False,
                    local_commit=local_commit,
                    remote_commit=remote_commit,
                    error=error,
                    output=output,
                )
                respond(False, error=error, output=output)
                return

            self._report_update_finished(
                trigger=trigger,
                success=True,
                local_commit=local_commit,
                remote_commit=remote_commit,
            )
            respond(True, message="Update complete. Restarting edge agent...", output=output)
            self._schedule_graceful_exit()
        except subprocess.TimeoutExpired:
            self._report_update_finished(
                trigger=trigger,
                success=False,
                local_commit=local_commit,
                remote_commit=remote_commit,
                error="Update timed out.",
            )
            respond(False, error="Update timed out.")
        except FileNotFoundError as exc:
            self._report_update_finished(
                trigger=trigger,
                success=False,
                local_commit=local_commit,
                remote_commit=remote_commit,
                error=f"Required command not found: {exc}",
            )
            respond(False, error=f"Required command not found: {exc}")
        except Exception as exc:
            self._report_update_finished(
                trigger=trigger,
                success=False,
                local_commit=local_commit,
                remote_commit=remote_commit,
                error=str(exc),
            )
            respond(False, error=f"Update failed: {exc}")

    def _maybe_auto_update_on_boot(self) -> bool:
        """Apply pending updates on boot. Returns True if the agent is exiting to restart."""
        if not AUTO_UPDATE_ON_BOOT:
            return False

        version_info = self._check_git_versions()
        local_commit = version_info.get("gitCommit")
        remote_commit = version_info.get("remoteGitCommit")
        if not local_commit or not remote_commit or local_commit == remote_commit:
            return False

        self.send_log(
            f"Boot update available: local {local_commit[:8]} != remote {remote_commit[:8]}"
        )
        self._report_update_started("boot", local_commit, remote_commit)

        try:
            success, output, error = self._perform_service_update()
            if not success:
                self._report_update_finished(
                    trigger="boot",
                    success=False,
                    local_commit=local_commit,
                    remote_commit=remote_commit,
                    error=error,
                    output=output,
                )
                self.send_log(f"Boot update failed: {error}")
                return False

            self._report_update_finished(
                trigger="boot",
                success=True,
                local_commit=local_commit,
                remote_commit=remote_commit,
            )
            self.send_log("Boot update complete. Restarting edge agent...")
            self._schedule_graceful_exit()
            return True
        except Exception as exc:
            self._report_update_finished(
                trigger="boot",
                success=False,
                local_commit=local_commit,
                remote_commit=remote_commit,
                error=str(exc),
            )
            self.send_log(f"Boot update failed: {exc}")
            return False

    def _reboot_device(self) -> None:
        self.shutdown()
        subprocess.run(["sudo", "-n", "reboot"], check=False)

    # ── WiFi management ────────────────────────────────────────────────────────

    def _has_networkmanager(self) -> bool:
        try:
            result = subprocess.run(
                ["systemctl", "is-active", "NetworkManager"],
                capture_output=True, text=True, timeout=5,
            )
            return result.returncode == 0
        except Exception:
            return False

    def _apply_wifi(self, ssid: str, password: str) -> tuple[bool, str]:
        """Apply WiFi credentials via nmcli or wpa_supplicant."""
        if self._has_networkmanager():
            return self._apply_wifi_nmcli(ssid, password)
        return self._apply_wifi_wpa(ssid, password)

    def _apply_wifi_nmcli(self, ssid: str, password: str) -> tuple[bool, str]:
        conn_name = f"aura-{ssid}"
        # Remove existing connection with same name to prevent conflicts
        subprocess.run(["nmcli", "connection", "delete", conn_name],
                       capture_output=True, timeout=10)
        wifi_iface = os.environ.get("WIFI_IFACE", "wlan0")
        result = subprocess.run(
            [
                "nmcli", "device", "wifi", "connect", ssid,
                "password", password,
                "name", conn_name,
                "ifname", wifi_iface,
            ],
            capture_output=True, text=True, timeout=35,
        )
        if result.returncode == 0:
            return True, f"Connected to {ssid} via nmcli"
        err = (result.stderr or result.stdout or "nmcli connect failed").strip()
        return False, err

    def _apply_wifi_wpa(self, ssid: str, password: str) -> tuple[bool, str]:
        """Write wpa_supplicant.conf and reconfigure."""
        import re
        wifi_iface = os.environ.get("WIFI_IFACE", "wlan0")
        conf_path = "/etc/wpa_supplicant/wpa_supplicant.conf"
        # Generate PSK block
        psk_result = subprocess.run(
            ["wpa_passphrase", ssid, password], capture_output=True, text=True, timeout=10
        )
        if psk_result.returncode == 0:
            block = "\n" + "\n".join(
                line for line in psk_result.stdout.splitlines()
                if not line.strip().startswith("#psk=")
            )
        else:
            block = f'\nnetwork={{\n    ssid="{ssid}"\n    psk="{password}"\n}}\n'

        try:
            with open(conf_path, "r") as f:
                existing = f.read()
        except FileNotFoundError:
            existing = "country=IN\nctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\nupdate_config=1\n"

        existing = re.sub(
            r'\nnetwork=\{[^}]*ssid="' + re.escape(ssid) + r'"[^}]*\}', "", existing
        )
        new_conf = existing.rstrip() + block
        try:
            with open(conf_path, "w") as f:
                f.write(new_conf)
        except PermissionError:
            return False, "Permission denied writing wpa_supplicant.conf (run as root)"

        subprocess.run(["wpa_cli", "-i", wifi_iface, "reconfigure"],
                       capture_output=True, timeout=10)
        import time as _time
        _time.sleep(4)
        status_result = subprocess.run(
            ["wpa_cli", "-i", wifi_iface, "status"], capture_output=True, text=True, timeout=10
        )
        if "wpa_state=COMPLETED" in status_result.stdout:
            return True, f"Connected to {ssid} via wpa_supplicant"
        return False, "wpa_supplicant: could not connect — check SSID/password and try again"

    def _get_wifi_status(self) -> dict[str, Any]:
        """Return current WiFi connection state."""
        wifi_iface = os.environ.get("WIFI_IFACE", "wlan0")
        if self._has_networkmanager():
            result = subprocess.run(
                ["nmcli", "-t", "-f", "DEVICE,STATE,CONNECTION", "device"],
                capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.splitlines():
                parts = line.split(":")
                if parts and parts[0] == wifi_iface:
                    state = parts[1] if len(parts) > 1 else ""
                    ssid = parts[2] if len(parts) > 2 else ""
                    connected = state == "connected"
                    return {"connected": connected, "ssid": ssid if connected else None, "message": state}
        # Fallback: check ip route
        ip_result = subprocess.run(
            ["ip", "-4", "addr", "show", wifi_iface], capture_output=True, text=True, timeout=10
        )
        for line in ip_result.stdout.splitlines():
            line = line.strip()
            if line.startswith("inet "):
                ip_addr = line.split()[1].split("/")[0]
                if not ip_addr.startswith("169.254."):
                    return {"connected": True, "ssid": None, "ip": ip_addr}
        return {"connected": False, "ssid": None}

    def _handle_device_command(self, request_id: str, command: str, params: dict[str, Any]) -> None:
        def respond(success: bool, message: str = "", **extra: Any) -> None:
            self._send_command_response(request_id, success, message=message, **extra)

        if command == "update_service":
            self.send_log("Edge update requested from cloud dashboard.")
            threading.Thread(
                target=self._run_update,
                args=(request_id,),
                name="edge-update",
                daemon=True,
            ).start()
            return

        if command == "reboot":
            self.send_log("Device reboot requested from cloud dashboard.")
            respond(True, message="Device reboot initiated.")
            threading.Timer(1.0, self._reboot_device).start()
            return

        if command == "fetch_logs":
            lines = max(10, min(int(params.get("lines", 200)), 2000))
            source = str(params.get("source", "all")).lower()
            allowed_sources = {"all", "agent", "journal", "worker"}
            if source not in allowed_sources:
                respond(False, error=f"Invalid log source '{source}'.")
                return
            try:
                sections: list[str] = []

                if source in ("all", "agent"):
                    file_logs = self.agent_logger.tail(lines)
                    if file_logs:
                        if source == "agent":
                            respond(True, logs=file_logs)
                            return
                        sections.append(
                            f"=== Persistent agent log ({AGENT_LOG_FILE}, last {lines} lines) ===\n{file_logs}"
                        )

                if source in ("all", "worker"):
                    worker_logs = AgentLogger(WORKER_LOG_FILE).tail(lines)
                    if worker_logs:
                        if source == "worker":
                            respond(True, logs=worker_logs)
                            return
                        sections.append(
                            f"=== Worker log ({WORKER_LOG_FILE}, last {lines} lines) ===\n{worker_logs}"
                        )

                if source in ("all", "journal"):
                    result = subprocess.run(
                        [
                            "journalctl",
                            "-u",
                            "aura-watch-edge.service",
                            "-n",
                            str(lines),
                            "--no-pager",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                    journal_logs = result.stdout.strip() or result.stderr.strip()
                    if journal_logs:
                        if source == "journal":
                            respond(True, logs=journal_logs)
                            return
                        sections.append(f"=== systemd journal (aura-watch-edge) ===\n{journal_logs}")

                if not sections:
                    if source == "worker":
                        logs = "No worker logs available yet."
                    elif source == "agent":
                        logs = "No agent logs available yet."
                    elif source == "journal":
                        logs = "No journal logs available."
                    else:
                        logs = "No logs available (agent.log missing and journal empty)."
                else:
                    logs = "\n\n".join(sections)
                respond(True, logs=logs)
            except FileNotFoundError:
                respond(False, error="journalctl not found on this device.")
            except Exception as exc:
                respond(False, error=f"Failed to fetch logs: {exc}")
            return

        if command == "fetch_metrics":
            try:
                if platform.system() != "Linux":
                    respond(False, error="System metrics are only available on Linux edge devices.")
                    return
                respond(True, metrics=collect_system_metrics())
            except Exception as exc:
                respond(False, error=f"Failed to collect metrics: {exc}")
            return

        if command == "check_version":
            try:
                version_info = self._check_git_versions()
                local_commit = version_info.get("gitCommit")
                remote_commit = version_info.get("remoteGitCommit")
                if local_commit and remote_commit:
                    if local_commit != remote_commit:
                        self.send_log(
                            f"Update available: local {local_commit[:8]} != remote {remote_commit[:8]}"
                        )
                    else:
                        self.send_log(f"Git version up to date ({local_commit[:8]})")
                respond(
                    True,
                    message="Version check complete.",
                    gitCommit=local_commit,
                    remoteGitCommit=remote_commit,
                )
            except Exception as exc:
                respond(False, error=f"Version check failed: {exc}")
            return

        if command == "set_wifi":
            ssid = params.get("ssid", "")
            password = params.get("password", "")
            if not ssid:
                respond(False, error="ssid is required")
                return
            if platform.system() != "Linux":
                respond(False, error="WiFi configuration is only supported on Linux edge devices.")
                return
            self.send_log(f"[WiFi] Applying WiFi credentials for SSID: {ssid}")
            try:
                success, message = self._apply_wifi(ssid, str(password))
                if success:
                    self.send_log(f"[WiFi] Successfully connected to: {ssid}")
                    respond(True, message=message)
                else:
                    self.send_log(f"[WiFi] Failed to connect to {ssid}: {message}")
                    respond(False, error=message)
            except Exception as exc:
                respond(False, error=f"WiFi configuration failed: {exc}")
            return

        if command == "get_wifi_status":
            if platform.system() != "Linux":
                respond(True, connected=False, message="Not a Linux device")
                return
            try:
                status = self._get_wifi_status()
                respond(True, **status)
            except Exception as exc:
                respond(False, error=f"Could not get WiFi status: {exc}")
            return

        if command == "scan_rtsp_cameras":
            self.send_log("[Discovery] Scanning local network for RTSP cameras...")
            try:
                result = scan_rtsp_cameras()
                cameras = result.get("cameras", [])
                subnet = result.get("subnet")
                scanned_hosts = result.get("scannedHosts", 0)
                self.send_log(
                    f"[Discovery] Found {len(cameras)} RTSP camera(s) after scanning "
                    f"{scanned_hosts} host(s) on {subnet or 'local network'}."
                )
                respond(
                    True,
                    message=result.get("message") or f"Found {len(cameras)} camera(s).",
                    cameras=cameras,
                    subnet=subnet,
                    scannedHosts=scanned_hosts,
                )
            except Exception as exc:
                self.send_log(f"[Discovery] Network scan failed: {exc}")
                respond(False, error=f"Network scan failed: {exc}")
            return

        respond(False, error=f"Unknown device command: {command}")

    def _handle_stream_file_request(self, request_id: str, filename: str):
        if filename.startswith("clip_") and filename.endswith(".mp4"):
            file_path = os.path.join(LOCAL_CLIPS_DIR, filename)
            if not os.path.exists(file_path):
                file_path = os.path.join(LOCAL_VIDEO_DIR, filename)
            content_type = "video/mp4"
        elif filename.startswith("crop_") and filename.endswith(".jpg"):
            file_path = os.path.join(LOCAL_CROPS_DIR, filename)
            content_type = "image/jpeg"
        else:
            self._ws_send(
                {
                    "type": "response_stream_file",
                    "requestId": request_id,
                    "success": False,
                    "error": f"Unsupported file: {filename}",
                }
            )
            return

        if not os.path.exists(file_path):
            self._ws_send(
                {
                    "type": "response_stream_file",
                    "requestId": request_id,
                    "success": False,
                    "error": f"File {filename} not found",
                }
            )
            return

        try:
            file_size = os.path.getsize(file_path)
            with open(file_path, "rb") as handle:
                self._ws_send(
                    {
                        "type": "response_stream_file_begin",
                        "requestId": request_id,
                        "contentType": content_type,
                        "size": file_size,
                    }
                )

                while True:
                    chunk = handle.read(STREAM_FILE_CHUNK_BYTES)
                    if not chunk:
                        break
                    encoded = base64.b64encode(chunk).decode("ascii")
                    self._ws_send(
                        {
                            "type": "response_stream_file_chunk",
                            "requestId": request_id,
                            "data": encoded,
                        }
                    )

            self._ws_send(
                {
                    "type": "response_stream_file_end",
                    "requestId": request_id,
                    "success": True,
                }
            )
        except Exception as exc:
            self._ws_send(
                {
                    "type": "response_stream_file",
                    "requestId": request_id,
                    "success": False,
                    "error": f"Error reading file: {exc}",
                }
            )

    def _on_ws_message(self, _ws, message: str):
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "configure":
                threading.Thread(
                    target=self._apply_hub_configure,
                    args=(data.get("deviceConfig"), data.get("streams", [])),
                    name="hub-configure",
                    daemon=True,
                ).start()

            elif msg_type == "toggle_stream":
                if self.live_preview_enabled:
                    stream_id = data.get("streamId")
                    stream_state = bool(data.get("stream", False))
                    p_data = self.pipelines.get(stream_id)
                    config = self.streams_config.get(stream_id)
                    name = config.name if config else stream_id
                    if p_data:
                        p_data["stream_frames"] = stream_state
                        p_data["last_preview_sent_at"] = 0.0
                        p_data["preview_stalled"] = False
                        state = "enabled" if stream_state else "disabled"
                        self.send_log(f"[{name}] Low-latency preview streaming {state}.")
                    else:
                        self.send_log(
                            f"[{name}] Preview {('enable' if stream_state else 'disable')} requested "
                            f"but pipeline is not ready yet."
                        )

            elif msg_type == "request_stream_file":
                threading.Thread(
                    target=self._handle_stream_file_request,
                    args=(data["requestId"], data["filename"]),
                    name=f"stream-file-{data.get('filename', 'unknown')}",
                    daemon=True,
                ).start()

            elif msg_type == "delete_clip_file":
                filename = data.get("filename", "")
                if filename.startswith("crop_") and filename.endswith(".jpg"):
                    file_path = os.path.join(LOCAL_CROPS_DIR, filename)
                else:
                    file_path = os.path.join(LOCAL_CLIPS_DIR, filename)
                    if not os.path.exists(file_path):
                        file_path = os.path.join(LOCAL_VIDEO_DIR, filename)
                if os.path.exists(file_path):
                    os.unlink(file_path)
                    self.send_log(f"Deleted file on edge: {filename}")

            elif msg_type == "device_command":
                threading.Thread(
                    target=self._handle_device_command,
                    args=(data.get("requestId", ""), data.get("command", ""), data),
                    name=f"hub-cmd-{data.get('command', 'unknown')}",
                    daemon=True,
                ).start()

        except Exception as exc:
            print(f"[Edge WS] Error processing message: {exc}")

    def _schedule_heartbeat(self):
        if self.shutdown_event.is_set():
            return
        self._ws_send({"type": "heartbeat"})
        self.heartbeat_timer = threading.Timer(10.0, self._schedule_heartbeat)
        self.heartbeat_timer.daemon = True
        self.heartbeat_timer.start()

    def _schedule_preview_stall_check(self):
        if self.shutdown_event.is_set() or not self.live_preview_enabled:
            return
        self._check_preview_stalls()
        self.preview_stall_timer = threading.Timer(2.0, self._schedule_preview_stall_check)
        self.preview_stall_timer.daemon = True
        self.preview_stall_timer.start()

    def _on_ws_open(self, _ws):
        print("[Edge WS] Connected successfully to Cloud Hub.", flush=True)
        self.send_log("Reconnected to cloud hub.")
        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
        if self.preview_stall_timer:
            self.preview_stall_timer.cancel()
        self._schedule_heartbeat()
        if self.live_preview_enabled:
            self._schedule_preview_stall_check()
        self._replay_recent_logs()

        # Update and notify status for all active streams
        for stream_id, p_data in self.pipelines.items():
            config = self.streams_config.get(stream_id)
            if self.live_preview_enabled and p_data.get("stream_frames"):
                config_name = config.name if config else stream_id
                self.send_log(f"[{config_name}] Resuming live preview after cloud reconnect.")
            self.send_status(stream_id, self._resolve_stream_status(stream_id))

    def _on_ws_close(self, _ws, _status_code, _msg):
        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
        if self.preview_stall_timer:
            self.preview_stall_timer.cancel()

        # Close code 4001 means the hub rejected us because the device is not
        # registered.  Retrying immediately would just create a tight loop that
        # spams the backend logs.  Shut down and let the operator register the
        # device via the dashboard (or re-run with a valid enrollment token).
        if _status_code == 4001:
            print(
                "[Edge WS] Rejected by hub: device not registered (4001). "
                "Register this device via the dashboard before restarting the edge agent.",
                flush=True,
            )
            self._recent_logs.append(
                (
                    "Cloud WebSocket closed with 4001 — device not registered. "
                    "Shutting down to avoid retry loop.",
                    datetime.now(timezone.utc).isoformat(),
                )
            )
            self.shutdown_event.set()
            return

        print("[Edge WS] Connection closed. Retrying in 5 seconds...", flush=True)
        self._recent_logs.append(
            ("Cloud WebSocket disconnected. Retrying in 5 seconds...", datetime.now(timezone.utc).isoformat())
        )
        if len(self._recent_logs) > 100:
            self._recent_logs = self._recent_logs[-100:]
        if not self.shutdown_event.is_set():
            self.reconnect_timer = threading.Timer(5.0, self._reconnect_cloud_ws)
            self.reconnect_timer.daemon = True
            self.reconnect_timer.start()

    def _reconnect_cloud_ws(self):
        if self.shutdown_event.is_set():
            return
        try:
            print("[Edge WS] Re-registering device before reconnect...", flush=True)
            registered = self.register_device()
            streams_list = registered.get("streams", [])
            self.update_streams_config(streams_list)
        except Exception as exc:
            print(f"[Edge WS] Re-registration failed: {exc}", flush=True)
        self.connect_ws()

    def _on_ws_error(self, _ws, error):
        print(f"[Edge WS] Connection error: {error}", flush=True)
        message = f"Cloud WebSocket error: {error}"
        self._recent_logs.append((message, datetime.now(timezone.utc).isoformat()))
        if len(self._recent_logs) > 100:
            self._recent_logs = self._recent_logs[-100:]

    def connect_ws(self):
        if self.shutdown_event.is_set():
            return

        old_ws = self.ws
        old_thread = self.ws_thread
        self.ws = None
        self.ws_thread = None

        if old_ws:
            try:
                old_ws.close()
            except Exception:
                pass
        if old_thread and old_thread.is_alive() and old_thread is not threading.current_thread():
            old_thread.join(timeout=2)

        ws_url = f"{CLOUD_WS_URL}?role=device&deviceId={self.device_id}"
        print(f"[Edge WS] Connecting to {ws_url}...", flush=True)

        self.ws = websocket.WebSocketApp(
            ws_url,
            on_open=self._on_ws_open,
            on_message=self._on_ws_message,
            on_close=self._on_ws_close,
            on_error=self._on_ws_error,
        )
        self.ws_thread = threading.Thread(
            target=self.ws.run_forever,
            kwargs={"ping_interval": 45, "ping_timeout": 30},
            daemon=True,
        )
        self.ws_thread.start()

    def shutdown(self):
        if self.shutdown_event.is_set():
            return
        self.send_log(f"Agent shutdown initiated (pid={os.getpid()}).")
        self.shutdown_event.set()

        if hasattr(self, "worker_proc") and self.worker_proc:
            try:
                self.worker_proc.terminate()
                self.worker_proc.wait(timeout=3)
            except Exception:
                try:
                    self.worker_proc.kill()
                except Exception:
                    pass

        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
        if self.preview_stall_timer:
            self.preview_stall_timer.cancel()
        if self.health_heartbeat_timer:
            self.health_heartbeat_timer.cancel()
        if self.reconnect_timer:
            self.reconnect_timer.cancel()

        for stream_id in list(self.pipelines.keys()):
            self.stop_stream_pipeline(stream_id)

        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

        print("[Edge] Cleanup complete.", flush=True)

    def _sweep_stale_tmp_files(self) -> None:
        """Remove any leftover .json.tmp files from a previous crash."""
        try:
            for name_entry in os.listdir(LOCAL_VIDEO_DIR):
                if name_entry.endswith(".json.tmp"):
                    stale_path = os.path.join(LOCAL_VIDEO_DIR, name_entry)
                    try:
                        os.unlink(stale_path)
                        print(f"[Edge] Removed stale sidecar temp file: {name_entry}", flush=True)
                    except OSError as exc:
                        print(f"[Edge] Could not remove stale temp file {name_entry}: {exc}", flush=True)
        except Exception as exc:
            print(f"[Edge] Stale tmp sweep failed: {exc}", flush=True)

    def bootstrap(self):
        try:
            self._sweep_stale_tmp_files()
            last_line = self.agent_logger.last_line()
            if last_line:
                self.send_log(f"Agent starting (pid={os.getpid()}). Last persisted log: {last_line}")
            else:
                self.send_log(f"Agent starting (pid={os.getpid()}, device={self.device_id}).")
            print("[Edge] Registering device with Cloud Hub...", flush=True)
            registered = self.register_device()
            # Expecting response structure: {"device": ..., "streams": [...]}
            streams_list = registered.get("streams", [])
            print(
                f"[Edge] Registration successful. Applied {len(streams_list)} stream(s) config.",
                flush=True,
            )

            if self._maybe_auto_update_on_boot():
                while not self.shutdown_event.is_set():
                    time.sleep(1)
                return

            self.connect_ws()
            self._schedule_health_heartbeat()
            self.update_streams_config(streams_list)

            while not self.shutdown_event.is_set():
                time.sleep(1)
        except Exception as exc:
            print(f"[Edge] Bootstrap failed: {exc}", flush=True)
            print("[Edge] Retrying registration in 10s...", flush=True)
            time.sleep(10)
            if not self.shutdown_event.is_set():
                self.bootstrap()


def main():
    agent = EdgeAgent()

    def handle_signal(_signum, _frame):
        agent.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    agent.bootstrap()


if __name__ == "__main__":
    main()
