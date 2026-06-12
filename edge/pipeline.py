"""Threaded vision pipeline: capture, detect, on-demand clip encode, and live preview."""

from __future__ import annotations

import os
import queue
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

CAMERA_STALL_TIMEOUT_SEC = float(os.getenv("CAMERA_STALL_TIMEOUT_SEC", "45"))

import cv2
import numpy as np

from camera import CameraCapture
from recorder import ClipEncoder
from yolo_tracker import YoloByteTracker


@dataclass
class PipelineSettings:
    detect_interval: int = 2
    encode_fps: int = 10
    process_fps: int = 15
    stream_fps: float = 12.0
    jpeg_quality: int = 70
    tracking_enabled: bool = False
    camera_stall_timeout_sec: float = CAMERA_STALL_TIMEOUT_SEC


FrameCallback = Callable[[np.ndarray], None]
DetectionCallback = Callable[[list, bool], None]
ReidCallback = Callable[[bytes, int, float, tuple[int, int, int, int], str], None]
ClipEncoderGetter = Callable[[], Optional[ClipEncoder]]


class VisionPipeline:
    """Capture frames on a background thread and process the latest frame only."""

    def __init__(
        self,
        camera: CameraCapture,
        tracker: YoloByteTracker,
        settings: PipelineSettings,
        get_clip_encoder: Optional[ClipEncoderGetter] = None,
        on_preview_frame: Optional[FrameCallback] = None,
        on_detections: Optional[DetectionCallback] = None,
        on_reid_crop: Optional[ReidCallback] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ):
        self.camera = camera
        self.tracker = tracker
        self.settings = settings
        self.get_clip_encoder = get_clip_encoder
        self.on_preview_frame = on_preview_frame
        self.on_detections = on_detections
        self.on_reid_crop = on_reid_crop
        self.should_stop = should_stop or (lambda: False)

        self._frame_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=1)
        self._capture_thread: Optional[threading.Thread] = None
        self._frame_index = 0
        self._last_clip_write_at = 0.0

    def start_capture(self):
        self._capture_thread = threading.Thread(
            target=self._capture_loop,
            name="camera-capture",
            daemon=True,
        )
        self._capture_thread.start()

    def run(self):
        stream_interval = 1.0 / max(self.settings.stream_fps, 1.0)
        last_stream_time = 0.0
        last_frame_time = time.monotonic()
        last_frame_received_at = time.monotonic()

        while not self.should_stop():
            try:
                frame = self._frame_queue.get(timeout=0.5)
            except queue.Empty:
                stalled_for = time.monotonic() - last_frame_received_at
                if stalled_for >= self.settings.camera_stall_timeout_sec:
                    detail = self.camera.last_error or "no frames from camera"
                    raise RuntimeError(
                        f"Camera stream lost ({detail}; no frame for {stalled_for:.0f}s)"
                    )
                continue

            last_frame_received_at = time.monotonic()
            self._frame_index += 1
            run_inference = self._frame_index % max(self.settings.detect_interval, 1) == 0

            annotated, detections, new_detection, stabilized = self.tracker.process(
                frame,
                run_inference=run_inference,
                tracking_enabled=self.settings.tracking_enabled,
            )

            if self.on_detections:
                self.on_detections(detections, new_detection)

            if self.on_reid_crop and stabilized:
                h_f, w_f = frame.shape[:2]
                for d in stabilized:
                    x1 = max(0, min(d.bbox[0], w_f - 1))
                    y1 = max(0, min(d.bbox[1], h_f - 1))
                    x2 = max(0, min(d.bbox[2], w_f))
                    y2 = max(0, min(d.bbox[3], h_f))
                    if x2 > x1 and y2 > y1:
                        crop = frame[y1:y2, x1:x2]
                        ok, jpeg_buf = cv2.imencode(".jpg", crop)
                        if ok:
                            self.on_reid_crop(jpeg_buf.tobytes(), d.track_id, d.confidence, d.bbox, d.class_name)

            clip_encoder = self.get_clip_encoder() if self.get_clip_encoder else None
            if clip_encoder:
                frame_interval = 1.0 / max(self.settings.encode_fps, 1)
            else:
                frame_interval = 1.0 / max(self.settings.process_fps, 1)

            now = time.monotonic()
            if self.on_preview_frame and now - last_stream_time >= stream_interval:
                self.on_preview_frame(annotated)
                last_stream_time = now

            elapsed = time.monotonic() - last_frame_time
            sleep_for = frame_interval - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)
            last_frame_time = time.monotonic()

    def _capture_loop(self):
        consecutive_failures = 0
        while not self.should_stop():
            frame = self.camera.read()
            if frame is None:
                consecutive_failures += 1
                if consecutive_failures == 100:
                    detail = self.camera.last_error or "camera.read() returned None"
                    print(
                        f"[Camera] Warning: no frames after {consecutive_failures} reads ({detail})",
                        flush=True,
                    )
                time.sleep(0.05)
                continue

            consecutive_failures = 0

            clip_encoder = self.get_clip_encoder() if self.get_clip_encoder else None
            if clip_encoder:
                clip_interval = 1.0 / max(self.settings.encode_fps, 1)
                now = time.monotonic()
                if now - self._last_clip_write_at >= clip_interval:
                    clip_encoder.write_frame(frame)
                    self._last_clip_write_at = now

            try:
                self._frame_queue.put_nowait(frame)
            except queue.Full:
                try:
                    self._frame_queue.get_nowait()
                except queue.Empty:
                    pass
                try:
                    self._frame_queue.put_nowait(frame)
                except queue.Full:
                    pass

    def join_capture(self, timeout: float = 5.0):
        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=timeout)


def encode_preview_jpeg(frame: np.ndarray, quality: int = 70) -> Optional[bytes]:
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return None
    return buffer.tobytes()
