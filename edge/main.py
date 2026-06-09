#!/usr/bin/env python3
"""Aura Watch edge agent — YOLO + ByteTrack annotated HLS streaming."""

from __future__ import annotations

import base64
import json
import os
import signal
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
    HlsEncoder,
    clear_directory,
    concat_hls_segments,
    copy_new_hls_segments,
    get_video_duration_seconds,
    kill_ffmpeg_for_dir,
    remove_directory,
    transcode_for_gemini,
    upload_clip,
)
from stream_server import HlsStreamServer
from yolo_tracker import YoloByteTracker, class_names_from_flags, parse_class_names, resolve_yolo_device

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

CLOUD_URL = os.getenv("CLOUD_URL", "https://aura-watch.adboardtools.com")
CLOUD_WS_URL = os.getenv("CLOUD_WS_URL", "wss://aura-watch.adboardtools.com")
DEVICE_NAME = os.getenv("DEVICE_NAME", "Office Edge Device")
LOCAL_VIDEO_DIR = os.getenv("LOCAL_VIDEO_DIR", os.path.join(BASE_DIR, "storage", "temp_clips"))
HLS_DIR = os.path.join(BASE_DIR, "storage", "hls")
DEVICE_ID_FILE = os.path.join(BASE_DIR, ".device-id")
DEBUG_LOGS = os.getenv("DEBUG_LOGS", "true").lower() != "false"
YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.25"))
YOLO_DEVICE = resolve_yolo_device(os.getenv("YOLO_DEVICE", "auto"))
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "416"))
YOLO_DETECT_INTERVAL = max(int(os.getenv("YOLO_DETECT_INTERVAL", "2")), 1)
FRAME_STREAM_FPS = float(os.getenv("FRAME_STREAM_FPS", "12"))
HLS_SEGMENT_SEC = float(os.getenv("HLS_SEGMENT_SEC", "1"))
EDGE_HTTP_PORT = int(os.getenv("EDGE_HTTP_PORT", "8090"))
PREVIEW_JPEG_QUALITY = int(os.getenv("PREVIEW_JPEG_QUALITY", "70"))
RECORDING_COOLDOWN_SEC = float(os.getenv("RECORDING_COOLDOWN_SEC", "45"))
RECORDING_MAX_SEC = float(os.getenv("RECORDING_MAX_SEC", "60"))
RECORDING_END_GRACE_SEC = float(os.getenv("RECORDING_END_GRACE_SEC", "2"))


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
        self.config = EdgeConfig()
        self.ws: Optional[websocket.WebSocketApp] = None
        self.ws_thread: Optional[threading.Thread] = None
        self.heartbeat_timer: Optional[threading.Timer] = None
        self.reconnect_timer: Optional[threading.Timer] = None
        self.ws_lock = threading.Lock()
        self.shutdown_event = threading.Event()

        self.pipeline_thread: Optional[threading.Thread] = None
        self.pipeline_stop = threading.Event()
        self.is_pipeline_running = False
        self.is_recording = False
        self._recording_lock = threading.Lock()
        self._detection_lock = threading.Lock()
        self._last_detection_at = 0.0
        self._recording_cooldown_until = 0.0
        self._recording_thread: Optional[threading.Thread] = None
        self._active_tracker: Optional[YoloByteTracker] = None
        self.stream_frames = False

        self.hls_server = HlsStreamServer(HLS_DIR, EDGE_HTTP_PORT)
        self.stream_host = self.hls_server.stream_host

        os.makedirs(LOCAL_VIDEO_DIR, exist_ok=True)
        os.makedirs(HLS_DIR, exist_ok=True)

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

    def send_status(self, status: str):
        self._ws_send({"type": "status_change", "status": status})

    def _announce_stream_host(self):
        self._ws_send(
            {
                "type": "stream_announce",
                "streamHost": self.stream_host,
            }
        )

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
        payload = {
            "deviceId": self.device_id,
            "name": DEVICE_NAME,
            "cameraType": self.config.camera_type,
            "streamUrl": self.config.stream_url,
            "trackingEnabled": self.config.tracking_enabled,
            "motionThreshold": self.config.motion_threshold,
            "pixelChangeThreshold": self.config.pixel_change_threshold,
            "streamHost": self.stream_host,
            "status": "Idle",
        }
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()

    def prepare_hls_directory(self):
        os.makedirs(HLS_DIR, exist_ok=True)
        clear_directory(HLS_DIR)

    def stop_pipeline(self, update_status: bool = True):
        self.pipeline_stop.set()
        if self.pipeline_thread and self.pipeline_thread.is_alive():
            self.pipeline_thread.join(timeout=10)
        self.pipeline_thread = None
        self.is_pipeline_running = False
        if update_status:
            self.send_status("Idle")

    def start_pipeline(self):
        self.stop_pipeline()
        kill_ffmpeg_for_dir(HLS_DIR)
        self.prepare_hls_directory()
        self.pipeline_stop.clear()

        if not self.hls_server._httpd:
            self.hls_server.start()
            self.stream_host = self.hls_server.stream_host
            print(f"[Edge] HLS HTTP server listening at {self.stream_host}")

        self.pipeline_thread = threading.Thread(
            target=self._pipeline_loop,
            name="vision-pipeline",
            daemon=True,
        )
        self.pipeline_thread.start()
        self.is_pipeline_running = True
        self.send_status("Monitoring" if self.config.tracking_enabled else "Idle")

    def update_camera_state(self, force_restart: bool = False):
        if force_restart:
            self.send_log("Restarting camera pipeline to apply new configuration.")
            self.stop_pipeline()

        if not self.is_pipeline_running:
            self.start_pipeline()
        else:
            self.send_status("Monitoring" if self.config.tracking_enabled else "Idle")

    def _pipeline_loop(self):
        retry_delay = 10.0
        consecutive_failures = 0

        while not self.pipeline_stop.is_set() and not self.shutdown_event.is_set():
            camera = CameraCapture(
                camera_type=self.config.camera_type,
                stream_url=self.config.stream_url,
            )
            if not camera.open():
                consecutive_failures += 1
                detail = camera.last_error or "unknown error"
                self.send_log(
                    f"[Detector Error] Failed to open camera ({detail}). "
                    f"Retrying in {int(retry_delay)}s..."
                )
                self.send_status("Idle")
                if self._wait(retry_delay):
                    break
                retry_delay = min(retry_delay * 1.5, 60.0)
                continue

            retry_delay = 10.0
            consecutive_failures = 0
            detection_classes = self.config.detection_classes()
            tracker = YoloByteTracker(
                confidence=YOLO_CONFIDENCE,
                device=YOLO_DEVICE,
                class_names=detection_classes,
                imgsz=YOLO_IMGSZ,
            )
            self._active_tracker = tracker
            self.send_log(
                f"Detection targets: {', '.join(detection_classes)} | "
                f"device={YOLO_DEVICE} imgsz={YOLO_IMGSZ} interval={YOLO_DETECT_INTERVAL}"
            )
            encoder = HlsEncoder(
                HLS_DIR,
                camera.width,
                camera.height,
                fps=30,
                segment_sec=HLS_SEGMENT_SEC,
            )
            encoder.start()

            self.send_log(
                f"Started YOLO+ByteTrack pipeline ({camera.width}x{camera.height}) "
                f"for: {self.config.name}"
            )
            self.send_status("Monitoring" if self.config.tracking_enabled else "Idle")

            settings = PipelineSettings(
                detect_interval=YOLO_DETECT_INTERVAL,
                encode_fps=30,
                stream_fps=FRAME_STREAM_FPS,
                jpeg_quality=PREVIEW_JPEG_QUALITY,
                hls_segment_sec=HLS_SEGMENT_SEC,
                tracking_enabled=self.config.tracking_enabled,
            )

            def on_preview(frame):
                if self.stream_frames:
                    self._send_annotated_frame(frame, settings.jpeg_quality)

            def on_reid(crop_jpeg, track_id, confidence, bbox):
                threading.Thread(
                    target=self._upload_reid_crop,
                    args=(crop_jpeg, track_id, confidence, bbox),
                    daemon=True,
                ).start()

            def on_detections(detections, new_detection):
                with self._detection_lock:
                    if detections:
                        self._last_detection_at = time.monotonic()
                if new_detection and self.config.tracking_enabled:
                    names = ", ".join(sorted({d.class_name for d in detections}))
                    if not self._try_start_clip_recording(names):
                        with self._recording_lock:
                            in_cooldown = time.monotonic() < self._recording_cooldown_until
                        if in_cooldown:
                            tracker.reset_detection_edge()

            pipeline = VisionPipeline(
                camera=camera,
                tracker=tracker,
                encoder=encoder,
                settings=settings,
                on_preview_frame=on_preview,
                on_detections=on_detections,
                on_reid_crop=on_reid,
                should_stop=lambda: self.pipeline_stop.is_set() or self.shutdown_event.is_set(),
            )

            try:
                pipeline.start_capture()
                pipeline.run()
            except Exception as exc:
                self.send_log(f"[Detector Error] {exc}. Reconnecting...")
            finally:
                pipeline.join_capture()
                encoder.stop()
                camera.release()
                tracker.reset()
                if self._active_tracker is tracker:
                    self._active_tracker = None

            if self.pipeline_stop.is_set() or self.shutdown_event.is_set():
                break

            self.send_status("Idle")
            if self._wait(retry_delay):
                break

        self.is_pipeline_running = False

    def _wait(self, seconds: float) -> bool:
        """Wait up to `seconds`, returning True if shutdown was requested."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.pipeline_stop.is_set() or self.shutdown_event.is_set():
                return True
            time.sleep(0.25)
        return False

    def _send_annotated_frame(self, frame, quality: int = PREVIEW_JPEG_QUALITY):
        jpeg = encode_preview_jpeg(frame, quality)
        if not jpeg:
            return
        encoded = base64.b64encode(jpeg).decode("ascii")
        self._ws_send({"type": "frame", "image": encoded})

    def _upload_reid_crop(self, crop_jpeg: bytes, track_id: int, confidence: float, bbox: tuple[int, int, int, int]):
        url = f"{CLOUD_URL.rstrip('/')}/api/devices/{self.device_id}/reid/crop"
        bbox_str = ",".join(map(str, bbox))
        headers = {
            "Content-Type": "image/jpeg",
            "x-track-id": str(track_id),
            "x-confidence": f"{confidence:.4f}",
            "x-bbox": bbox_str,
            "x-timestamp": str(int(time.time() * 1000)),
            "x-class-name": "person",
        }
        try:
            response = requests.post(url, data=crop_jpeg, headers=headers, timeout=15)
            if response.status_code >= 200 and response.status_code < 300:
                self.send_log(f"Successfully uploaded ReID crop for track {track_id}")
            else:
                self.send_log(f"[ReID Error] Upload failed ({response.status_code}): {response.text}")
        except Exception as exc:
            self.send_log(f"[ReID Error] Upload exception: {exc}")

    def _try_start_clip_recording(self, detection_names: str) -> bool:
        with self._recording_lock:
            if self.is_recording:
                return False
            if self._recording_thread and self._recording_thread.is_alive():
                return False
            if time.monotonic() < self._recording_cooldown_until:
                return False
            self.is_recording = True
            self._last_detection_at = time.monotonic()

        self.send_log(f"Objects detected: {detection_names}. Starting clip capture...")
        self._recording_thread = threading.Thread(
            target=self._run_clip_recording,
            args=(detection_names,),
            daemon=True,
        )
        self._recording_thread.start()
        return True

    def _run_clip_recording(self, _detection_names: str):
        self.send_status("Recording")

        timestamp_ms = int(time.time() * 1000)
        filename = f"clip_{timestamp_ms}_{self.device_id}.mp4"
        output_path = os.path.join(LOCAL_VIDEO_DIR, filename)
        staging_dir = os.path.join(LOCAL_VIDEO_DIR, f"staging_{timestamp_ms}_{self.device_id}")
        copied_segments: set[str] = set()
        recording_start = time.monotonic()

        self.send_log(
            f"Recording while objects are detected (max {int(RECORDING_MAX_SEC)}s, stream continues)..."
        )

        try:
            while not self.pipeline_stop.is_set() and not self.shutdown_event.is_set():
                copy_new_hls_segments(HLS_DIR, staging_dir, copied_segments)
                elapsed = time.monotonic() - recording_start

                with self._detection_lock:
                    last_detection_at = self._last_detection_at

                if elapsed >= RECORDING_MAX_SEC:
                    self.send_log(f"Max clip length ({int(RECORDING_MAX_SEC)}s) reached.")
                    break

                if (
                    elapsed >= RECORDING_END_GRACE_SEC
                    and time.monotonic() - last_detection_at >= RECORDING_END_GRACE_SEC
                ):
                    self.send_log("Objects left frame — finalizing clip.")
                    break

                time.sleep(0.4)

            copy_new_hls_segments(HLS_DIR, staging_dir, copied_segments)

            if not copied_segments:
                raise RuntimeError("No HLS segments captured during recording")

            duration = len(copied_segments) * HLS_SEGMENT_SEC
            self.send_log(
                f"Compiling ~{duration}s of footage ({len(copied_segments)} segments) into {filename}..."
            )
            concat_hls_segments(staging_dir, output_path)
            actual_duration = get_video_duration_seconds(output_path) or duration
            self.send_log(f"Clip compiled successfully: {filename} ({actual_duration:.1f}s)")

            upload_path = output_path
            temp_gemini_path = ""

            if os.getenv("GEMINI_OPTIMIZE", "true").lower() == "true":
                temp_gemini_path = os.path.join(
                    LOCAL_VIDEO_DIR,
                    f"temp_gemini_{timestamp_ms}_{self.device_id}.mp4",
                )
                try:
                    self.send_log("Optimizing clip for Gemini...")
                    transcode_for_gemini(
                        output_path,
                        temp_gemini_path,
                        fps=os.getenv("GEMINI_OPTIMIZE_FPS", "1"),
                        resolution=os.getenv("GEMINI_OPTIMIZE_RESOLUTION", "640:480"),
                        crf=os.getenv("GEMINI_OPTIMIZE_CRF", "28"),
                    )
                    if os.path.exists(temp_gemini_path):
                        upload_path = temp_gemini_path
                except Exception as exc:
                    self.send_log(f"[Transcode Warning] {exc}. Using original clip.")

            self.send_log(f"Uploading clip to Cloud: {filename}...")
            upload_clip(
                CLOUD_URL,
                self.device_id,
                upload_path,
                filename,
                duration=actual_duration,
            )
            self.send_log(f"Successfully uploaded clip to Cloud: {filename}")

            if temp_gemini_path and os.path.exists(temp_gemini_path):
                os.unlink(temp_gemini_path)
        except Exception as exc:
            self.send_log(f"Clip generation failed: {exc}")
        finally:
            remove_directory(staging_dir)
            with self._recording_lock:
                self.is_recording = False
                self._recording_cooldown_until = time.monotonic() + RECORDING_COOLDOWN_SEC
            if RECORDING_COOLDOWN_SEC > 0:
                self.send_log(
                    f"Clip cooldown started ({int(RECORDING_COOLDOWN_SEC)}s before next clip can begin)."
                )
            if self._active_tracker:
                self._active_tracker.reset_detection_edge()
            if self.is_pipeline_running:
                self.send_status("Monitoring" if self.config.tracking_enabled else "Idle")

    def _handle_stream_file_request(self, request_id: str, filename: str):
        is_clip = filename.startswith("clip_") and filename.endswith(".mp4")
        base_dir = LOCAL_VIDEO_DIR if is_clip else HLS_DIR
        file_path = os.path.join(base_dir, filename)

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
            is_playlist = filename.endswith(".m3u8")
            is_mp4 = filename.endswith(".mp4")
            content_type = (
                "application/x-mpegURL"
                if is_playlist
                else ("video/mp4" if is_mp4 else "video/MP2T")
            )

            if is_playlist:
                with open(file_path, "r", encoding="utf-8") as handle:
                    data = handle.read()
            else:
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
                cfg = data.get("config", {})
                self.send_log(f"Applying new configuration: {cfg.get('name', self.config.name)}")
                self.config = EdgeConfig(
                    name=cfg.get("name", self.config.name),
                    camera_type=cfg.get("cameraType", self.config.camera_type),
                    stream_url=cfg.get("streamUrl", self.config.stream_url),
                    tracking_enabled=bool(cfg.get("trackingEnabled", self.config.tracking_enabled)),
                    motion_threshold=int(cfg.get("motionThreshold", self.config.motion_threshold)),
                    pixel_change_threshold=float(
                        cfg.get("pixelChangeThreshold", self.config.pixel_change_threshold)
                    ),
                    detect_person=bool(cfg.get("detectPerson", self.config.detect_person)),
                    detect_vehicle=bool(cfg.get("detectVehicle", self.config.detect_vehicle)),
                )
                self.update_camera_state(force_restart=True)

            elif msg_type == "toggle_stream":
                self.stream_frames = bool(data.get("stream", False))
                state = "enabled" if self.stream_frames else "disabled"
                self.send_log(f"Low-latency preview streaming {state}.")

            elif msg_type == "request_stream_file":
                self._handle_stream_file_request(data["requestId"], data["filename"])

            elif msg_type == "delete_clip_file":
                filename = data.get("filename", "")
                file_path = os.path.join(LOCAL_VIDEO_DIR, filename)
                if os.path.exists(file_path):
                    os.unlink(file_path)
                    self.send_log(f"Deleted clip file on edge: {filename}")

        except Exception as exc:
            print(f"[Edge WS] Error processing message: {exc}")

    def _schedule_heartbeat(self):
        if self.shutdown_event.is_set():
            return
        self._ws_send({"type": "heartbeat", "streamHost": self.stream_host})
        self.heartbeat_timer = threading.Timer(10.0, self._schedule_heartbeat)
        self.heartbeat_timer.daemon = True
        self.heartbeat_timer.start()

    def _on_ws_open(self, _ws):
        print("[Edge WS] Connected successfully to Cloud Hub.")
        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
        self._schedule_heartbeat()
        self._announce_stream_host()

        if self.is_recording:
            status = "Recording"
        elif self.is_pipeline_running:
            status = "Monitoring" if self.config.tracking_enabled else "Idle"
        else:
            status = "Idle"
        self.send_status(status)

    def _on_ws_close(self, _ws, _status_code, _msg):
        print("[Edge WS] Connection closed. Retrying in 5 seconds...")
        if self.heartbeat_timer:
            self.heartbeat_timer.cancel()
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
        print(f"[Edge WS] Connecting to {CLOUD_WS_URL}...")

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
        if self.reconnect_timer:
            self.reconnect_timer.cancel()

        self.stop_pipeline()
        self.hls_server.stop()
        kill_ffmpeg_for_dir(HLS_DIR)
        clear_directory(HLS_DIR)

        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

        print("[Edge] Cleanup complete.")

    def bootstrap(self):
        try:
            self.hls_server.start()
            self.stream_host = self.hls_server.stream_host
            print(f"[Edge] HLS HTTP server listening at {self.stream_host}")

            print("[Edge] Registering device with Cloud Hub...")
            registered = self.register_device()
            print("[Edge] Registration successful. Applied config:", registered)

            self.config = EdgeConfig(
                name=registered.get("name", self.config.name),
                camera_type=registered.get("cameraType", self.config.camera_type),
                stream_url=registered.get("streamUrl", self.config.stream_url),
                tracking_enabled=bool(registered.get("trackingEnabled", self.config.tracking_enabled)),
                motion_threshold=int(registered.get("motionThreshold", self.config.motion_threshold)),
                pixel_change_threshold=float(
                    registered.get("pixelChangeThreshold", self.config.pixel_change_threshold)
                ),
                detect_person=bool(registered.get("detectPerson", True)),
                detect_vehicle=bool(registered.get("detectVehicle", True)),
            )

            self.connect_ws()
            self.update_camera_state()

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
