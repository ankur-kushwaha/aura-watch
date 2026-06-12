"""On-demand clip encoding, transcoding, and cloud upload."""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
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


class ClipEncoder:
    """Pipe annotated BGR frames into FFmpeg for a single MP4 clip file."""

    def __init__(self, output_path: str, width: int, height: int, fps: int = 10):
        self.output_path = output_path
        self.width = width
        self.height = height
        self.fps = max(fps, 1)
        self.process: Optional[subprocess.Popen] = None
        self._write_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=2)
        self._writer_thread: Optional[threading.Thread] = None
        self._stop_writer = threading.Event()
        self.frames_written = 0

    def start(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.output_path)), exist_ok=True)
        loglevel = ffmpeg_loglevel()
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
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-g",
            str(self.fps),
            "-pix_fmt",
            "yuv420p",
            "-an",
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


def transcode_for_gemini(
    input_path: str,
    output_path: str,
    fps: str = "1",
    resolution: str = "640:480",
    crf: str = "28",
):
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-vf",
            f"fps={fps},scale={resolution}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            crf,
            "-an",
            output_path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg transcode failed: {result.stderr}")


def clip_meets_upload_threshold(duration_sec: float, min_duration_sec: float) -> bool:
    """Return False when clip is below configured minimum duration (0 = no minimum)."""
    if min_duration_sec <= 0:
        return True
    return duration_sec >= min_duration_sec


def upload_clip(
    cloud_url: str,
    device_id: str,
    filepath: str,
    filename: str,
    duration: Optional[float] = None,
    stream_id: Optional[str] = None,
    track_events: Optional[list] = None,
    frame_width: Optional[int] = None,
    frame_height: Optional[int] = None,
    clip_start_ms: Optional[int] = None,
):
    url = f"{cloud_url.rstrip('/')}/api/devices/{device_id}/upload"
    size = os.path.getsize(filepath)
    headers = {
        "Content-Type": "application/octet-stream",
        "x-filename": filename,
        "Content-Length": str(size),
    }
    if duration is not None and duration > 0:
        headers["x-duration"] = f"{duration:.2f}"
    if stream_id:
        headers["x-stream-id"] = stream_id
    if track_events:
        headers["x-track-events"] = json.dumps(track_events)
    if frame_width is not None and frame_width > 0:
        headers["x-frame-width"] = str(frame_width)
    if frame_height is not None and frame_height > 0:
        headers["x-frame-height"] = str(frame_height)
    if clip_start_ms is not None:
        headers["x-clip-start-ms"] = str(clip_start_ms)

    with open(filepath, "rb") as handle:
        response = requests.post(url, data=handle, headers=headers, timeout=120)

    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"Upload failed ({response.status_code}): {response.text}")
