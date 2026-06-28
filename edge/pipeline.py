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
    capture_fps: int = 15
    stream_fps: float = 12.0
    jpeg_quality: int = 70
    tracking_enabled: bool = False
    camera_stall_timeout_sec: float = CAMERA_STALL_TIMEOUT_SEC
    motion_threshold: int = 25
    pixel_change_threshold: float = 0.02
    preroll_sec: float = CLIP_PREROLL_SEC


FrameCallback = Callable[[np.ndarray], None]
MotionStartCallback = Callable[[float, Callable[[], list[np.ndarray]]], None]
MotionActiveCallback = Callable[[], None]
ClipEncoderGetter = Callable[[], Optional[ClipEncoder]]
IsClipRecordingCallback = Callable[[], bool]


class VisionPipeline:
    """Capture frames on a background thread; motion-detect on the processing thread."""

    def __init__(
        self,
        camera: CameraCapture,
        settings: PipelineSettings,
        get_clip_encoder: Optional[ClipEncoderGetter] = None,
        is_clip_recording: Optional[IsClipRecordingCallback] = None,
        on_preview_frame: Optional[FrameCallback] = None,
        on_motion_start: Optional[MotionStartCallback] = None,
        on_motion_active: Optional[MotionActiveCallback] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ):
        self.camera = camera
        self.settings = settings
        self.get_clip_encoder = get_clip_encoder
        self.is_clip_recording = is_clip_recording
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
        self._clip_feed_encoder: Optional[ClipEncoder] = None
        self._latest_frame: Optional[np.ndarray] = None
        self._clip_frame_interval = 1.0 / max(settings.clip_fps, 1)
        self._last_preroll_at = 0.0
        self._motion_active = False
        self._continuous_feed_encoder: Optional[ClipEncoder] = None
        self._encode_every_n = max(
            1,
            round(max(settings.capture_fps, 1) / max(min(settings.capture_fps, settings.clip_fps), 1)),
        )
        self._encode_frame_idx = 0

    def start_clip_feed(self, encoder: ClipEncoder) -> None:
        """Register encoder so each captured camera frame is written once (no duplicate ticks)."""
        self._clip_feed_encoder = encoder

    def stop_clip_feed(self) -> None:
        self._clip_feed_encoder = None

    def start_continuous_feed(self, encoder: ClipEncoder) -> None:
        """Register encoder for live push; frames are written from the capture loop."""
        self._continuous_feed_encoder = encoder

    def stop_continuous_feed(self) -> None:
        self._continuous_feed_encoder = None

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
                clip_recording = (
                    self.is_clip_recording() if self.is_clip_recording else False
                )

                if clip_recording:
                    # During an active clip, use a lower keepalive threshold so subtle
                    # frame changes (slow movement, compression drift) still extend
                    # recording instead of tripping the end-grace timer early.
                    keepalive_ratio = max(
                        self.settings.pixel_change_threshold * 0.25, 0.002
                    )
                    if ratio >= keepalive_ratio:
                        self._motion_active = True
                        if self.on_motion_active:
                            self.on_motion_active()
                elif motion_detected:
                    if not self._motion_active:
                        self._motion_active = True
                        if self.on_motion_start:
                            self.on_motion_start(ratio, self._preroll.snapshot)
                else:
                    self._motion_active = False

            now = time.monotonic()
            if self.on_preview_frame and now - last_stream_time >= stream_interval:
                self.on_preview_frame(frame)
                last_stream_time = now

    def _feed_active_encoders(self, frame: np.ndarray) -> None:
        self._encode_frame_idx += 1
        if self._encode_frame_idx % self._encode_every_n != 0:
            return

        clip_encoder = self._clip_feed_encoder
        if clip_encoder and clip_encoder.is_running():
            clip_encoder.write_frame(frame)

        live_encoder = self._continuous_feed_encoder
        if live_encoder and live_encoder.is_running():
            live_encoder.write_frame(frame)

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
            self._feed_active_encoders(frame)

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
        self.stop_continuous_feed()
        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=timeout)


def encode_preview_jpeg(frame: np.ndarray, quality: int = 70) -> Optional[bytes]:
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return None
    return buffer.tobytes()
