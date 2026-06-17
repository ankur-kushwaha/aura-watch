"""Threaded capture pipeline: motion watch, pre-roll buffer, on-demand clip encode, live preview."""

from __future__ import annotations

import os
import queue
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

CAMERA_STALL_TIMEOUT_SEC = float(os.getenv("CAMERA_STALL_TIMEOUT_SEC", "45"))
CLIP_PREROLL_SEC = float(os.getenv("CLIP_PREROLL_SEC", "3"))

import cv2
import numpy as np

from camera import CameraCapture
from frame_buffer import FrameRingBuffer
from motion_detector import MotionDetector
from recorder import ClipEncoder


@dataclass
class PipelineSettings:
    clip_fps: int = 15
    stream_fps: float = 12.0
    jpeg_quality: int = 70
    tracking_enabled: bool = False
    camera_stall_timeout_sec: float = CAMERA_STALL_TIMEOUT_SEC
    motion_threshold: int = 25
    pixel_change_threshold: float = 0.02
    preroll_sec: float = CLIP_PREROLL_SEC


FrameCallback = Callable[[np.ndarray], None]
MotionStartCallback = Callable[[float, list[np.ndarray]], None]
MotionActiveCallback = Callable[[], None]
ClipEncoderGetter = Callable[[], Optional[ClipEncoder]]


class VisionPipeline:
    """Capture frames on a background thread; motion-detect on the processing thread."""

    def __init__(
        self,
        camera: CameraCapture,
        settings: PipelineSettings,
        get_clip_encoder: Optional[ClipEncoderGetter] = None,
        on_preview_frame: Optional[FrameCallback] = None,
        on_motion_start: Optional[MotionStartCallback] = None,
        on_motion_active: Optional[MotionActiveCallback] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ):
        self.camera = camera
        self.settings = settings
        self.get_clip_encoder = get_clip_encoder
        self.on_preview_frame = on_preview_frame
        self.on_motion_start = on_motion_start
        self.on_motion_active = on_motion_active
        self.should_stop = should_stop or (lambda: False)

        preroll_capacity = max(int(settings.preroll_sec * settings.clip_fps), 1)
        self._preroll = FrameRingBuffer(preroll_capacity)
        self._motion = MotionDetector(
            motion_threshold=settings.motion_threshold,
            pixel_change_threshold=settings.pixel_change_threshold,
        )
        self._frame_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=1)
        self._capture_thread: Optional[threading.Thread] = None
        self._clip_feed_thread: Optional[threading.Thread] = None
        self._clip_feed_stop = threading.Event()
        self._clip_feed_encoder: Optional[ClipEncoder] = None
        self._latest_frame: Optional[np.ndarray] = None
        self._clip_frame_interval = 1.0 / max(settings.clip_fps, 1)
        self._last_preroll_at = 0.0
        self._motion_active = False

    def start_clip_feed(self, encoder: ClipEncoder) -> None:
        """Write the latest camera frame on a wall-clock tick so clip length matches recording time."""
        self.stop_clip_feed()
        self._clip_feed_encoder = encoder
        self._clip_feed_stop.clear()
        self._clip_feed_thread = threading.Thread(
            target=self._clip_feed_loop,
            name="clip-feed",
            daemon=True,
        )
        self._clip_feed_thread.start()

    def stop_clip_feed(self) -> None:
        self._clip_feed_stop.set()
        if self._clip_feed_thread and self._clip_feed_thread.is_alive():
            self._clip_feed_thread.join(timeout=2.0)
        self._clip_feed_thread = None
        self._clip_feed_encoder = None

    def _clip_feed_loop(self) -> None:
        next_tick = time.monotonic()
        while not self._clip_feed_stop.is_set():
            encoder = self._clip_feed_encoder
            frame = self._latest_frame
            if encoder and frame is not None and encoder.is_running():
                encoder.write_frame(frame.copy())

            next_tick += self._clip_frame_interval
            sleep_for = next_tick - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)
            else:
                next_tick = time.monotonic()

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

            if self.settings.tracking_enabled:
                motion_detected, ratio = self._motion.detect(frame)
                if motion_detected:
                    if not self._motion_active:
                        self._motion_active = True
                        if self.on_motion_start:
                            self.on_motion_start(ratio, self._preroll.snapshot())
                    elif self.on_motion_active:
                        self.on_motion_active()
                else:
                    self._motion_active = False

            now = time.monotonic()
            if self.on_preview_frame and now - last_stream_time >= stream_interval:
                self.on_preview_frame(frame)
                last_stream_time = now

            elapsed = time.monotonic() - last_frame_time
            sleep_for = self._clip_frame_interval - elapsed
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
            self._latest_frame = frame

            now = time.monotonic()
            if now - self._last_preroll_at >= self._clip_frame_interval:
                self._preroll.push(frame)
                self._last_preroll_at = now

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
        self.stop_clip_feed()
        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=timeout)


def encode_preview_jpeg(frame: np.ndarray, quality: int = 70) -> Optional[bytes]:
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return None
    return buffer.tobytes()
