"""Clip encoding and hub notification."""

from __future__ import annotations

import os
import queue
import subprocess
import threading
import time
from typing import Optional

import numpy as np
import requests

_FFMPEG_LOG_LEVELS = frozenset(
    {"quiet", "panic", "fatal", "error", "warning", "info", "verbose", "debug", "trace"}
)


def ffmpeg_loglevel() -> str:
    """Resolve FFmpeg -loglevel from FFMPEG_LOGLEVEL or DEBUG_LOGS."""
    explicit = os.getenv("FFMPEG_LOGLEVEL", "").strip().lower()
    if explicit in _FFMPEG_LOG_LEVELS:
        return explicit
    if os.getenv("DEBUG_LOGS", "true").lower() != "false":
        return "info"
    return "error"


def _log_ffmpeg_stderr(process: subprocess.Popen, prefix: str) -> None:
    if not process.stderr:
        return
    for line in process.stderr:
        text = line.decode("utf-8", errors="replace").strip()
        if text:
            print(f"[{prefix}] {text}", flush=True)


def subsample_frames(frames: list[np.ndarray], target_count: int) -> list[np.ndarray]:
    """Evenly pick frames so count matches target FPS × duration (avoids preroll time-stretch)."""
    if target_count <= 0:
        return []
    if len(frames) <= target_count:
        return list(frames)
    return [
        frames[min(int(i * len(frames) / target_count), len(frames) - 1)]
        for i in range(target_count)
    ]


def _escape_tee_target(target: str) -> str:
    # Escape backslashes, colons, and commas for FFmpeg's tee muxer
    return target.replace("\\", "\\\\").replace(":", "\\:").replace(",", "\\,")


def _clip_video_encode_args(fps: int, *, low_latency: bool = False) -> list[str]:
    """x264 settings tuned for surveillance clips (smooth motion, modest CPU)."""
    if low_latency:
        return [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-g",
            str(fps),
            "-pix_fmt",
            "yuv420p",
            "-an",
        ]
    return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-g",
        str(max(fps * 2, 1)),
        "-pix_fmt",
        "yuv420p",
        "-an",
    ]


class ClipEncoder:
    """Pipe annotated BGR frames into FFmpeg for a single MP4 clip file."""

    def __init__(self, output_path: str, width: int, height: int, fps: int = 10, remote_stream_url: Optional[str] = None, only_remote: bool = False):
        self.output_path = output_path
        self.width = width
        self.height = height
        self.fps = max(fps, 1)
        self.remote_stream_url = remote_stream_url
        self.only_remote = only_remote
        self.process: Optional[subprocess.Popen] = None
        self._write_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=8)
        self._writer_thread: Optional[threading.Thread] = None
        self._stop_writer = threading.Event()
        self.frames_written = 0

    def start(self):
        if not self.only_remote:
            os.makedirs(os.path.dirname(os.path.abspath(self.output_path)), exist_ok=True)
        loglevel = ffmpeg_loglevel()
        
        if self.only_remote and self.remote_stream_url:
            args = [
                "ffmpeg",
                "-y",
                "-loglevel",
                loglevel,
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{self.width}x{self.height}",
                "-r",
                str(self.fps),
                "-i",
                "pipe:0",
                "-map",
                "0:v",
                *_clip_video_encode_args(self.fps, low_latency=True),
                "-f",
                "rtsp",
                "-rtsp_transport",
                "tcp",
                self.remote_stream_url,
            ]
        elif self.remote_stream_url:
            escaped_file = _escape_tee_target(os.path.abspath(self.output_path))
            escaped_remote = _escape_tee_target(self.remote_stream_url)
            args = [
                "ffmpeg",
                "-y",
                "-loglevel",
                loglevel,
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{self.width}x{self.height}",
                "-r",
                str(self.fps),
                "-i",
                "pipe:0",
                "-map",
                "0:v",
                *_clip_video_encode_args(self.fps, low_latency=True),
                "-flags",
                "+global_header",
                "-f",
                "tee",
                f"[f=mp4]{escaped_file}|[f=rtsp:onfail=ignore:rtsp_transport=tcp]{escaped_remote}",
            ]
        else:
            args = [
                "ffmpeg",
                "-y",
                "-loglevel",
                loglevel,
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{self.width}x{self.height}",
                "-r",
                str(self.fps),
                "-i",
                "pipe:0",
                "-map",
                "0:v",
                *_clip_video_encode_args(self.fps),
                "-movflags",
                "+faststart",
                self.output_path,
            ]
        self.process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._stop_writer.clear()
        self.frames_written = 0
        self._writer_thread = threading.Thread(
            target=self._writer_loop,
            name="clip-writer",
            daemon=True,
        )
        self._writer_thread.start()
        if loglevel not in ("quiet", "panic", "fatal", "error"):
            threading.Thread(
                target=_log_ffmpeg_stderr,
                args=(self.process, "FFmpeg clip"),
                daemon=True,
            ).start()

    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def write_frame(self, frame: np.ndarray):
        if not self.is_running():
            return
        try:
            self._write_queue.put_nowait(frame)
        except queue.Full:
            try:
                self._write_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._write_queue.put_nowait(frame)
            except queue.Full:
                pass

    def write_frame_blocking(self, frame: np.ndarray, timeout: float = 2.0) -> bool:
        """Queue a frame, waiting briefly so burst writes (e.g. preroll) are not dropped."""
        if not self.is_running():
            return False
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                self._write_queue.put(frame, timeout=min(0.05, remaining))
                return True
            except queue.Full:
                continue
        return False

    def write_frames_blocking(self, frames: list[np.ndarray]) -> int:
        written = 0
        for frame in frames:
            if self.write_frame_blocking(frame):
                written += 1
        return written

    def _writer_loop(self):
        while not self._stop_writer.is_set():
            try:
                frame = self._write_queue.get(timeout=0.25)
            except queue.Empty:
                continue

            if not self.process or not self.process.stdin:
                continue

            if frame.shape[1] != self.width or frame.shape[0] != self.height:
                import cv2

                frame = cv2.resize(frame, (self.width, self.height))

            try:
                self.process.stdin.write(frame.tobytes())
                self.frames_written += 1
            except (BrokenPipeError, OSError):
                break

    def stop(self):
        self._stop_writer.set()
        if self._writer_thread and self._writer_thread.is_alive():
            self._writer_thread.join(timeout=3)

        if not self.process:
            return

        if self.process.stdin:
            try:
                self.process.stdin.close()
            except OSError:
                pass

        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)

        self.process = None
        self._writer_thread = None


def kill_ffmpeg_for_path(path: str):
    try:
        subprocess.run(
            ["pkill", "-9", "-f", f"ffmpeg.*{path}"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        pass


def get_video_duration_seconds(path: str) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return 0.0
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0



def clip_meets_upload_threshold(duration_sec: float, min_duration_sec: float) -> bool:
    """Return False when clip is below configured minimum duration (0 = no minimum)."""
    if min_duration_sec <= 0:
        return True
    return duration_sec >= min_duration_sec


def notify_clip_generated(
    cloud_url: str,
    device_id: str,
    filename: str,
    duration: Optional[float] = None,
    stream_id: Optional[str] = None,
    frame_width: Optional[int] = None,
    frame_height: Optional[int] = None,
    clip_start_ms: Optional[int] = None,
):
    """Notify hub that a clip was recorded on edge (metadata only — no video upload)."""
    url = f"{cloud_url.rstrip('/')}/api/devices/{device_id}/clips"
    payload: dict = {"filename": filename}
    if duration is not None and duration > 0:
        payload["duration"] = duration
    if stream_id:
        payload["streamId"] = stream_id
    if frame_width is not None and frame_width > 0:
        payload["frameWidth"] = frame_width
    if frame_height is not None and frame_height > 0:
        payload["frameHeight"] = frame_height
    if clip_start_ms is not None:
        payload["clipStartMs"] = clip_start_ms

    response = requests.post(url, json=payload, timeout=15)
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"Clip notify failed ({response.status_code}): {response.text}")
