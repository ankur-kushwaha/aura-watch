#!/usr/bin/env python3
"""Aura Watch edge agent — YOLO + ByteTrack annotated video streaming."""

from __future__ import annotations

import base64
import json
import os
import platform
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests
import websocket
from dotenv import load_dotenv

from camera import CameraCapture
from pipeline import PipelineSettings, VisionPipeline, encode_preview_jpeg
from recorder import (
    ClipEncoder,
    get_video_duration_seconds,
    kill_ffmpeg_for_path,
    upload_clip,
)
from yolo_tracker import YoloByteTracker, class_names_from_flags, parse_class_names, resolve_yolo_device

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))


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
DEVICE_ID_FILE = os.path.join(BASE_DIR, ".device-id")
DEBUG_LOGS = os.getenv("DEBUG_LOGS", "true").lower() != "false"
YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.25"))
YOLO_DEVICE = resolve_yolo_device(os.getenv("YOLO_DEVICE", "auto"))
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "416"))
YOLO_DETECT_INTERVAL = max(int(os.getenv("YOLO_DETECT_INTERVAL", "2")), 1)
CAMERA_FPS = max(int(os.getenv("CAMERA_FPS", "30")), 1)
FRAME_STREAM_FPS = float(os.getenv("FRAME_STREAM_FPS", "12"))
CLIP_ENCODE_FPS = max(int(os.getenv("CLIP_ENCODE_FPS", os.getenv("ENCODE_FPS", "10"))), 1)
PREVIEW_JPEG_QUALITY = int(os.getenv("PREVIEW_JPEG_QUALITY", "70"))
RECORDING_COOLDOWN_SEC = float(os.getenv("RECORDING_COOLDOWN_SEC", "45"))
RECORDING_MAX_SEC = float(os.getenv("RECORDING_MAX_SEC", "60"))
RECORDING_END_GRACE_SEC = float(os.getenv("RECORDING_END_GRACE_SEC", "2"))
PREVIEW_STALL_TIMEOUT_SEC = float(os.getenv("PREVIEW_STALL_TIMEOUT_SEC", "5"))


@dataclass
class EdgeConfig:
    name: str = DEVICE_NAME
    camera_type: str = "webcam"
    stream_url: str = "0"
    tracking_enabled: bool = False
    motion_threshold: int = 25
    pixel_change_threshold: float = 0.02
    detect_person: bool = True
    detect_vehicle: bool = True

    def detection_classes(self) -> list[str]:
        classes = class_names_from_flags(self.detect_person, self.detect_vehicle)
        if classes:
            return classes
        return parse_class_names(os.getenv("YOLO_CLASSES", "person,vehicle"))


class EdgeAgent:
    def __init__(self):
        self.device_id = self._load_or_create_device_id()
        self.ws: Optional[websocket.WebSocketApp] = None
        self.ws_thread: Optional[threading.Thread] = None
        self.heartbeat_timer: Optional[threading.Timer] = None
        self.preview_stall_timer: Optional[threading.Timer] = None
        self.reconnect_timer: Optional[threading.Timer] = None
        self.ws_lock = threading.Lock()
        self.shutdown_event = threading.Event()

        # Multi-stream configurations and pipelines
        self.streams_config: dict[str, EdgeConfig] = {}
        self.pipelines: dict[str, dict[str, Any]] = {}

        os.makedirs(LOCAL_VIDEO_DIR, exist_ok=True)
        os.makedirs(LOCAL_CROPS_DIR, exist_ok=True)
        os.makedirs(os.path.join(BASE_DIR, "storage"), exist_ok=True)

    def _load_or_create_device_id(self) -> str:
        if os.path.exists(DEVICE_ID_FILE):
            with open(DEVICE_ID_FILE, "r", encoding="utf-8") as handle:
                device_id = handle.read().strip()
            print(f"[Edge] Loaded persistent device ID: {device_id}")
            return device_id

        import secrets

        device_id = "edge_" + secrets.token_hex(8)
        with open(DEVICE_ID_FILE, "w", encoding="utf-8") as handle:
            handle.write(device_id)
        print(f"[Edge] Generated and saved new device ID: {device_id}")
        return device_id

    def send_log(self, message: str):
        print(f"[Edge Log] {message}")
        self._ws_send({"type": "log", "message": message})

    def send_status(self, stream_id: str, status: str):
        self._ws_send({"type": "status_change", "streamId": stream_id, "status": status})

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

    def register_device(self) -> dict[str, Any]:
        url = f"{CLOUD_URL.rstrip('/')}/api/devices/register"
        # Backwards compatible parameters if hub expects single-stream fields
        payload = {
            "deviceId": self.device_id,
            "name": DEVICE_NAME,
            "cameraType": "webcam",
            "streamUrl": "0",
            "trackingEnabled": False,
            "motionThreshold": 25,
            "pixelChangeThreshold": 0.02,
            "status": "Idle",
        }
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()

    def update_streams_config(self, streams_data: list[dict[str, Any]]):
        active_ids = set()
        for s in streams_data:
            stream_id = s.get("streamId")
            active_ids.add(stream_id)

            config = EdgeConfig(
                name=s.get("name", "Unnamed Stream"),
                camera_type=s.get("cameraType", "webcam"),
                stream_url=s.get("streamUrl", "0"),
                tracking_enabled=bool(s.get("trackingEnabled", False)),
                motion_threshold=int(s.get("motionThreshold", 25)),
                pixel_change_threshold=float(s.get("pixelChangeThreshold", 0.02)),
                detect_person=bool(s.get("detectPerson", True)),
                detect_vehicle=bool(s.get("detectVehicle", True)),
            )

            existing = self.streams_config.get(stream_id)
            if not existing or (
                existing.camera_type != config.camera_type
                or existing.stream_url != config.stream_url
                or existing.tracking_enabled != config.tracking_enabled
                or existing.detect_person != config.detect_person
                or existing.detect_vehicle != config.detect_vehicle
                or existing.motion_threshold != config.motion_threshold
                or existing.pixel_change_threshold != config.pixel_change_threshold
            ):
                self.streams_config[stream_id] = config
                self.restart_stream_pipeline(stream_id)
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
            "last_detection_at": 0.0,
            "recording_lock": threading.Lock(),
            "detection_lock": threading.Lock(),
            "clip_encoder_lock": threading.Lock(),
            "clip_encoder": None,
            "frame_width": 0,
            "frame_height": 0,
            "stream_frames": False,
            "last_preview_sent_at": 0.0,
            "preview_stalled": False,
            "clip_track_events": [],
            "clip_track_events_lock": threading.Lock(),
            "recording_started_at_mono": None,
            "recording_started_at_ms": None,
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

    def stop_stream_pipeline(self, stream_id: str):
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
        self.send_status(stream_id, "Offline")

    def restart_stream_pipeline(self, stream_id: str):
        config = self.streams_config.get(stream_id)
        name = config.name if config else stream_id
        existing = self.pipelines.get(stream_id)
        was_streaming_preview = bool(existing and existing.get("stream_frames"))
        self.send_log(f"Restarting stream pipeline to apply new configuration for: {name}")
        self.stop_stream_pipeline(stream_id)
        self.start_stream_pipeline(stream_id)
        if was_streaming_preview:
            p_data = self.pipelines.get(stream_id)
            if p_data:
                p_data["stream_frames"] = True
                p_data["last_preview_sent_at"] = 0.0
                p_data["preview_stalled"] = False

    def _stream_pipeline_loop(self, stream_id: str, stop_event: threading.Event):
        retry_delay = 10.0
        consecutive_failures = 0

        while not stop_event.is_set() and not self.shutdown_event.is_set():
            config = self.streams_config.get(stream_id)
            if not config:
                break

            camera = CameraCapture(
                camera_type=config.camera_type,
                stream_url=config.stream_url,
            )
            if not camera.open():
                consecutive_failures += 1
                detail = camera.last_error or "unknown error"
                self.send_log(
                    f"[{config.name}] Failed to open camera ({detail}). "
                    f"Retrying in {int(retry_delay)}s..."
                )
                self.send_status(stream_id, "Idle")
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
                camera.release()
                self.send_status(stream_id, "Idle")
                if self._wait_stream(stop_event, retry_delay):
                    break
                retry_delay = min(retry_delay * 1.5, 60.0)
                continue

            retry_delay = 10.0
            consecutive_failures = 0
            detection_classes = config.detection_classes()
            tracker = YoloByteTracker(
                confidence=YOLO_CONFIDENCE,
                device=YOLO_DEVICE,
                class_names=detection_classes,
                imgsz=YOLO_IMGSZ,
            )

            pipeline_data = self.pipelines.get(stream_id)
            if not pipeline_data:
                camera.release()
                break

            pipeline_data["camera"] = camera
            pipeline_data["tracker"] = tracker
            pipeline_data["frame_width"] = camera.width
            pipeline_data["frame_height"] = camera.height

            self.send_log(
                f"[{config.name}] Detection targets: {', '.join(detection_classes)} | "
                f"device={YOLO_DEVICE} imgsz={YOLO_IMGSZ} interval={YOLO_DETECT_INTERVAL}"
            )

            self.send_log(
                f"[{config.name}] Started YOLO+ByteTrack pipeline ({camera.width}x{camera.height})"
            )
            self.send_status(stream_id, "Monitoring" if config.tracking_enabled else "Idle")

            settings = PipelineSettings(
                detect_interval=YOLO_DETECT_INTERVAL,
                encode_fps=CLIP_ENCODE_FPS,
                process_fps=CAMERA_FPS,
                stream_fps=FRAME_STREAM_FPS,
                jpeg_quality=PREVIEW_JPEG_QUALITY,
                tracking_enabled=config.tracking_enabled,
            )
            pipeline_data["settings"] = settings

            def get_clip_encoder() -> Optional[ClipEncoder]:
                p_data = self.pipelines.get(stream_id)
                if not p_data or not p_data.get("is_recording"):
                    return None
                with p_data["clip_encoder_lock"]:
                    return p_data.get("clip_encoder")

            def on_preview(frame):
                p_data = self.pipelines.get(stream_id)
                if p_data and p_data.get("stream_frames", False):
                    self._send_annotated_frame(stream_id, frame, settings.jpeg_quality)

            def on_reid(crop_jpeg, track_id, confidence, bbox, class_name):
                p_data = self.pipelines.get(stream_id)
                if not p_data:
                    return

                started_mono = p_data.get("recording_started_at_mono")
                if p_data.get("is_recording") and started_mono is not None:
                    offset_ms = int((time.monotonic() - started_mono) * 1000)
                    bbox_str = ",".join(map(str, bbox))
                    event = {
                        "trackId": track_id,
                        "bbox": bbox_str,
                        "offsetMs": offset_ms,
                        "confidence": round(confidence, 4),
                        "className": class_name,
                    }
                    with p_data["clip_track_events_lock"]:
                        p_data["clip_track_events"].append(event)
                    return

                threading.Thread(
                    target=self._upload_reid_crop,
                    args=(stream_id, crop_jpeg, track_id, confidence, bbox),
                    daemon=True,
                ).start()

            def on_detections(detections, new_detection):
                p_data = self.pipelines.get(stream_id)
                if not p_data:
                    return
                with p_data["detection_lock"]:
                    if detections:
                        p_data["last_detection_at"] = time.monotonic()
                if new_detection and config.tracking_enabled:
                    names = ", ".join(sorted({d.class_name for d in detections}))
                    if not self._try_start_clip_recording(stream_id, names):
                        with p_data["recording_lock"]:
                            in_cooldown = time.monotonic() < p_data["recording_cooldown_until"]
                        if in_cooldown:
                            tracker.reset_detection_edge()

            pipeline = VisionPipeline(
                camera=camera,
                tracker=tracker,
                settings=settings,
                get_clip_encoder=get_clip_encoder,
                on_preview_frame=on_preview,
                on_detections=on_detections,
                on_reid_crop=on_reid,
                should_stop=lambda: stop_event.is_set() or self.shutdown_event.is_set(),
            )

            try:
                pipeline.start_capture()
                pipeline.run()
            except Exception as exc:
                self.send_log(f"[{config.name}] [Detector Error] {exc}. Reconnecting...")
            finally:
                pipeline.join_capture()
                self._stop_active_clip_encoder(pipeline_data)
                camera.release()
                tracker.reset()

            if stop_event.is_set() or self.shutdown_event.is_set():
                break

            self.send_status(stream_id, "Idle")
            if self._wait_stream(stop_event, retry_delay):
                break

    def _wait_stream(self, stop_event: threading.Event, seconds: float) -> bool:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if stop_event.is_set() or self.shutdown_event.is_set():
                return True
            time.sleep(0.25)
        return False

    def _send_annotated_frame(self, stream_id: str, frame, quality: int):
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
            if stalled_for >= PREVIEW_STALL_TIMEOUT_SEC:
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

    def _upload_reid_crop(self, stream_id: str, crop_jpeg: bytes, track_id: int, confidence: float, bbox: tuple[int, int, int, int]):
        url = f"{CLOUD_URL.rstrip('/')}/api/devices/{self.device_id}/reid/crop"
        bbox_str = ",".join(map(str, bbox))
        timestamp_ms = int(time.time() * 1000)
        filename = f"crop_{timestamp_ms}_{self.device_id}_{track_id}.jpg"
        local_path = os.path.join(LOCAL_CROPS_DIR, filename)
        try:
            with open(local_path, "wb") as handle:
                handle.write(crop_jpeg)
        except Exception as exc:
            self.send_log(f"[ReID Error] Failed to save local crop {filename}: {exc}")

        headers = {
            "Content-Type": "image/jpeg",
            "x-track-id": str(track_id),
            "x-confidence": f"{confidence:.4f}",
            "x-bbox": bbox_str,
            "x-timestamp": str(timestamp_ms),
            "x-class-name": "person",
            "x-stream-id": stream_id,
        }
        try:
            response = requests.post(url, data=crop_jpeg, headers=headers, timeout=15)
            if response.status_code >= 200 and response.status_code < 300:
                self.send_log(f"Successfully uploaded ReID crop for track {track_id} on stream {stream_id}")
            else:
                self.send_log(f"[ReID Error] Upload failed ({response.status_code}): {response.text}")
        except Exception as exc:
            self.send_log(f"[ReID Error] Upload exception: {exc}")

    def _try_start_clip_recording(self, stream_id: str, detection_names: str) -> bool:
        p_data = self.pipelines.get(stream_id)
        if not p_data:
            return False

        with p_data["recording_lock"]:
            if p_data["is_recording"]:
                return False
            if p_data["recording_thread"] and p_data["recording_thread"].is_alive():
                return False
            if time.monotonic() < p_data["recording_cooldown_until"]:
                return False
            p_data["is_recording"] = True
            p_data["last_detection_at"] = time.monotonic()
            p_data["recording_started_at_mono"] = time.monotonic()
            with p_data["clip_track_events_lock"]:
                p_data["clip_track_events"] = []

        config = self.streams_config.get(stream_id)
        name = config.name if config else stream_id
        self.send_log(f"[{name}] Objects detected: {detection_names}. Starting clip capture...")

        thread = threading.Thread(
            target=self._run_clip_recording,
            args=(stream_id, detection_names),
            daemon=True,
        )
        p_data["recording_thread"] = thread
        thread.start()
        return True

    def _run_clip_recording(self, stream_id: str, _detection_names: str):
        self.send_status(stream_id, "Recording")
        p_data = self.pipelines.get(stream_id)
        if not p_data:
            return

        config = self.streams_config.get(stream_id)
        name = config.name if config else stream_id

        timestamp_ms = int(time.time() * 1000)
        p_data["recording_started_at_ms"] = timestamp_ms
        filename = f"clip_{timestamp_ms}_{stream_id}.mp4"
        output_path = os.path.join(LOCAL_VIDEO_DIR, filename)
        width = p_data.get("frame_width") or 640
        height = p_data.get("frame_height") or 480
        clip_encoder: Optional[ClipEncoder] = None
        recording_start = time.monotonic()

        self.send_log(
            f"[{name}] Recording while objects are detected "
            f"(max {int(RECORDING_MAX_SEC)}s @ {CLIP_ENCODE_FPS}fps)..."
        )

        try:
            clip_encoder = ClipEncoder(output_path, width, height, fps=CLIP_ENCODE_FPS)
            clip_encoder.start()
            with p_data["clip_encoder_lock"]:
                p_data["clip_encoder"] = clip_encoder

            while not p_data["stop_event"].is_set() and not self.shutdown_event.is_set():
                elapsed = time.monotonic() - recording_start

                with p_data["detection_lock"]:
                    last_detection_at = p_data["last_detection_at"]

                if elapsed >= RECORDING_MAX_SEC:
                    self.send_log(f"[{name}] Max clip length ({int(RECORDING_MAX_SEC)}s) reached.")
                    break

                if (
                    elapsed >= RECORDING_END_GRACE_SEC
                    and time.monotonic() - last_detection_at >= RECORDING_END_GRACE_SEC
                ):
                    self.send_log(f"[{name}] Objects left frame — finalizing clip.")
                    break

                time.sleep(0.2)

            stopped_encoder = self._stop_active_clip_encoder(p_data)
            if stopped_encoder:
                clip_encoder = stopped_encoder

            if not clip_encoder or clip_encoder.frames_written < 2:
                raise RuntimeError("No frames captured during recording")

            if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
                raise RuntimeError("Clip file missing or too small after encoding")

            actual_duration = get_video_duration_seconds(output_path)
            if actual_duration <= 0:
                actual_duration = clip_encoder.frames_written / CLIP_ENCODE_FPS
            self.send_log(f"[{name}] Clip encoded: {filename} ({actual_duration:.1f}s)")

            with p_data["clip_track_events_lock"]:
                track_events = list(p_data.get("clip_track_events") or [])

            self.send_log(
                f"[{name}] Uploading clip to Cloud: {filename} "
                f"({len(track_events)} bundled track event(s))..."
            )
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
            )
            self.send_log(f"[{name}] Successfully uploaded clip to Cloud: {filename}")
        except Exception as exc:
            self.send_log(f"[{name}] Clip generation failed: {exc}")
            kill_ffmpeg_for_path(output_path)
            if os.path.exists(output_path):
                try:
                    os.unlink(output_path)
                except OSError:
                    pass
        finally:
            self._stop_active_clip_encoder(p_data)
            with p_data["recording_lock"]:
                p_data["is_recording"] = False
                p_data["recording_cooldown_until"] = time.monotonic() + RECORDING_COOLDOWN_SEC
            p_data["recording_started_at_mono"] = None
            p_data["recording_started_at_ms"] = None
            with p_data["clip_track_events_lock"]:
                p_data["clip_track_events"] = []
            if RECORDING_COOLDOWN_SEC > 0:
                self.send_log(
                    f"[{name}] Clip cooldown started ({int(RECORDING_COOLDOWN_SEC)}s before next clip can begin)."
                )
            tracker = p_data.get("tracker")
            if tracker:
                tracker.reset_detection_edge()

            p_data_curr = self.pipelines.get(stream_id)
            if p_data_curr and not p_data_curr["stop_event"].is_set():
                self.send_status(stream_id, "Monitoring" if (config and config.tracking_enabled) else "Idle")

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

    def _run_update(self, request_id: str) -> None:
        def respond(success: bool, message: str = "", **extra: Any) -> None:
            self._send_command_response(request_id, success, message=message, **extra)

        try:
            repo_root = self._find_repo_root()
            if not os.path.isdir(os.path.join(repo_root, ".git")):
                respond(False, error=f"No git repository found at {repo_root}. Install via install.sh first.")
                return

            self.send_log(f"Force-pulling latest code in {repo_root}...")
            pull_ok, pull_output = self._git_force_pull(repo_root)
            if not pull_ok:
                respond(False, error="git force pull failed", output=pull_output)
                return

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
                    respond(False, error="Python dependency update failed", output="\n\n".join(update_output))
                    return
            else:
                self.send_log("setup-venv.sh not found; skipping dependency update.")

            self.send_log("Refreshing systemd service unit...")
            systemd_ok, systemd_output = self._refresh_systemd_service(edge_dir)
            if systemd_output:
                update_output.append(systemd_output)
            if not systemd_ok:
                respond(False, error="Systemd service refresh failed", output="\n\n".join(update_output))
                return

            combined_output = "\n\n".join(part for part in update_output if part)
            respond(True, message="Update complete. Restarting edge agent...", output=combined_output)
            self._schedule_graceful_exit()
        except subprocess.TimeoutExpired:
            respond(False, error="Update timed out.")
        except FileNotFoundError as exc:
            respond(False, error=f"Required command not found: {exc}")
        except Exception as exc:
            respond(False, error=f"Update failed: {exc}")

    def _reboot_device(self) -> None:
        self.shutdown()
        subprocess.run(["sudo", "-n", "reboot"], check=False)

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
            try:
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
                logs = result.stdout.strip() or result.stderr.strip()
                if not logs:
                    logs = "No journal logs available for aura-watch-edge.service."
                respond(True, logs=logs)
            except FileNotFoundError:
                respond(False, error="journalctl not found on this device.")
            except Exception as exc:
                respond(False, error=f"Failed to fetch logs: {exc}")
            return

        respond(False, error=f"Unknown device command: {command}")

    def _handle_stream_file_request(self, request_id: str, filename: str):
        if filename.startswith("clip_") and filename.endswith(".mp4"):
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
            with open(file_path, "rb") as handle:
                data = base64.b64encode(handle.read()).decode("ascii")

            self._ws_send(
                {
                    "type": "response_stream_file",
                    "requestId": request_id,
                    "success": True,
                    "contentType": content_type,
                    "data": data,
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
                streams_data = data.get("streams", [])
                self.send_log(f"Applying updated configuration with {len(streams_data)} stream(s).")
                self.update_streams_config(streams_data)

            elif msg_type == "toggle_stream":
                stream_id = data.get("streamId")
                stream_state = bool(data.get("stream", False))
                p_data = self.pipelines.get(stream_id)
                if p_data:
                    p_data["stream_frames"] = stream_state
                    p_data["last_preview_sent_at"] = 0.0
                    p_data["preview_stalled"] = False
                    state = "enabled" if stream_state else "disabled"

            elif msg_type == "request_stream_file":
                self._handle_stream_file_request(data["requestId"], data["filename"])

            elif msg_type == "delete_clip_file":
                filename = data.get("filename", "")
                if filename.startswith("crop_") and filename.endswith(".jpg"):
                    file_path = os.path.join(LOCAL_CROPS_DIR, filename)
                else:
                    file_path = os.path.join(LOCAL_VIDEO_DIR, filename)
                if os.path.exists(file_path):
                    os.unlink(file_path)
                    self.send_log(f"Deleted file on edge: {filename}")

            elif msg_type == "device_command":
                self._handle_device_command(
                    data.get("requestId", ""),
                    data.get("command", ""),
                    data,
                )

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
        if self.shutdown_event.is_set():
            return
        self._check_preview_stalls()
        self.preview_stall_timer = threading.Timer(2.0, self._schedule_preview_stall_check)
        self.preview_stall_timer.daemon = True
        self.preview_stall_timer.start()

    def _on_ws_open(self, _ws):
        print("[Edge WS] Connected successfully to Cloud Hub.")
        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
        if self.preview_stall_timer:
            self.preview_stall_timer.cancel()
        self._schedule_heartbeat()
        self._schedule_preview_stall_check()

        # Update and notify status for all active streams
        for stream_id, p_data in self.pipelines.items():
            config = self.streams_config.get(stream_id)
            if p_data["is_recording"]:
                status = "Recording"
            elif p_data.get("camera") and p_data["camera"].is_opened():
                status = "Monitoring" if (config and config.tracking_enabled) else "Idle"
            else:
                status = "Idle"
            self.send_status(stream_id, status)

    def _on_ws_close(self, _ws, _status_code, _msg):
        print("[Edge WS] Connection closed. Retrying in 5 seconds...")
        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
        if self.preview_stall_timer:
            self.preview_stall_timer.cancel()
        if not self.shutdown_event.is_set():
            self.reconnect_timer = threading.Timer(5.0, self.connect_ws)
            self.reconnect_timer.daemon = True
            self.reconnect_timer.start()

    def _on_ws_error(self, _ws, error):
        print(f"[Edge WS] Connection error: {error}")

    def connect_ws(self):
        if self.shutdown_event.is_set():
            return

        ws_url = f"{CLOUD_WS_URL}?role=device&deviceId={self.device_id}"
        print(f"[Edge WS] Connecting to {ws_url}...")

        self.ws = websocket.WebSocketApp(
            ws_url,
            on_open=self._on_ws_open,
            on_message=self._on_ws_message,
            on_close=self._on_ws_close,
            on_error=self._on_ws_error,
        )
        self.ws_thread = threading.Thread(
            target=self.ws.run_forever,
            kwargs={"ping_interval": 30, "ping_timeout": 10},
            daemon=True,
        )
        self.ws_thread.start()

    def shutdown(self):
        if self.shutdown_event.is_set():
            return
        print("[Edge] Shutdown initiated. Cleaning up...")
        self.shutdown_event.set()

        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
        if self.preview_stall_timer:
            self.preview_stall_timer.cancel()
        if self.reconnect_timer:
            self.reconnect_timer.cancel()

        for stream_id in list(self.pipelines.keys()):
            self.stop_stream_pipeline(stream_id)

        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

        print("[Edge] Cleanup complete.")

    def bootstrap(self):
        try:
            print("[Edge] Registering device with Cloud Hub...")
            registered = self.register_device()
            # Expecting response structure: {"device": ..., "streams": [...]}
            streams_list = registered.get("streams", [])
            print(f"[Edge] Registration successful. Applied {len(streams_list)} stream(s) config.")

            self.connect_ws()
            self.update_streams_config(streams_list)

            while not self.shutdown_event.is_set():
                time.sleep(1)
        except Exception as exc:
            print(f"[Edge] Bootstrap failed: {exc}")
            print("[Edge] Retrying registration in 10s...")
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
