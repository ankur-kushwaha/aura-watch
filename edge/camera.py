"""Camera capture for webcam and RTSP sources."""

from __future__ import annotations

import os
import platform
import socket
import subprocess
import threading
import time
from typing import Optional
from urllib.parse import urlparse

import cv2
import numpy as np

from recorder import ffmpeg_loglevel, _log_ffmpeg_stderr

RTSP_TRANSPORTS = ("tcp", "udp", "auto")


def local_network_hint(host: str, port: int = 554) -> Optional[str]:
    """Return a user-facing hint when local LAN access appears blocked."""
    if not host:
        return None

    try:
        with socket.create_connection((host, port), timeout=3):
            return None
    except OSError as exc:
        # macOS: EHOSTUNREACH (65) — common when Cursor lacks Local Network permission
        if exc.errno not in (65, 113, 101):
            return None

    if platform.system() == "Darwin":
        return (
            "Cannot reach the camera on your local network from this process. "
            "If ping/VLC work in an external Terminal, macOS is likely blocking "
            "Cursor from Local Network access. Fix: System Settings → Privacy & Security "
            "→ Local Network → enable Cursor, then restart Cursor. "
            "Or run the edge agent from an external Terminal: cd edge && python3 main.py"
        )

    return (
        f"Cannot reach {host}:{port} from this process. "
        "Run the edge agent from a shell that has access to the camera network."
    )


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


class CameraCapture:
    def __init__(
        self,
        camera_type: str = "webcam",
        stream_url: str = "0",
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[int] = None,
    ):
        width = width if width is not None else _env_int("CAMERA_WIDTH", 640)
        height = height if height is not None else _env_int("CAMERA_HEIGHT", 480)
        fps = fps if fps is not None else _env_int("CAMERA_FPS", 30)
        self.camera_type = camera_type
        self.stream_url = stream_url
        self.width = width
        self.height = height
        self.fps = fps
        self._cap: Optional[cv2.VideoCapture] = None
        self._ffmpeg: Optional[_FfmpegFrameReader] = None
        self._last_error = ""

    @property
    def last_error(self) -> str:
        return self._last_error

    def open(self) -> bool:
        self._last_error = ""
        if self.camera_type == "rtsp":
            return self._open_rtsp()
        return self._open_webcam()

    def is_opened(self) -> bool:
        if self._ffmpeg:
            proc = self._ffmpeg.process
            return proc is not None and proc.poll() is None
        if self._cap:
            return self._cap.isOpened()
        return False

    def read(self) -> Optional[np.ndarray]:
        if self._ffmpeg:
            return self._ffmpeg.read()

        if not self._cap or not self._cap.isOpened():
            return None

        ok, frame = self._cap.read()
        if not ok or frame is None:
            return None
        return frame

    def release(self):
        if self._ffmpeg:
            self._ffmpeg.stop()
            self._ffmpeg = None

        if self._cap:
            self._cap.release()
            self._cap = None

    def _open_rtsp(self):
        preferred = os.getenv("RTSP_TRANSPORT", "tcp").lower()
        transports: list[Optional[str]]
        if preferred == "auto":
            transports = ["tcp", "udp", None]
        elif preferred in RTSP_TRANSPORTS:
            transports = [preferred if preferred != "auto" else None]
        else:
            transports = ["tcp", "udp", None]

        errors: list[str] = []
        host = _host_from_url(self.stream_url)

        for transport in transports:
            label = transport or "default"
            reader = _FfmpegFrameReader(
                self.stream_url,
                self.width,
                self.height,
                self.fps,
                transport=transport,
            )
            if reader.start():
                self._ffmpeg = reader
                self.width = reader.width
                self.height = reader.height
                return True

            errors.append(f"{label}: {reader.last_error}")
            reader.stop()

        hint = local_network_hint(host)
        detail = " | ".join(errors[-2:])
        self._last_error = f"{detail}. {hint}" if hint else detail
        return False

    def _open_webcam(self):
        errors: list[str] = []
        for source in self._webcam_candidates():
            if self._try_open_webcam_source(source):
                print(
                    f"[Camera] Opened source {source!r} ({self.width}x{self.height})",
                    flush=True,
                )
                return True
            errors.append(f"{source!r}: {self._last_error}")

        hint = (
            "On Raspberry Pi run: v4l2-ctl --list-devices && ls -la /dev/video* "
            "— then set stream URL to the working device (e.g. /dev/video0 or 0)."
        )
        if platform.system() == "Linux":
            self._last_error = f"{' | '.join(errors[-3:])}. {hint}"
        else:
            self._last_error = " | ".join(errors[-3:])
        return False

    def _webcam_candidates(self) -> list[int | str]:
        if self.stream_url.isdigit():
            return [int(self.stream_url)]

        if platform.system() == "Linux" and self.stream_url.startswith("/dev/"):
            return [self.stream_url]

        if platform.system() == "Linux":
            candidates: list[int | str] = []
            for index in range(8):
                path = f"/dev/video{index}"
                if os.path.exists(path):
                    candidates.append(path)
                    candidates.append(index)
            return candidates or [0, "/dev/video0"]

        if self.stream_url not in ("0", ""):
            return [self.stream_url]
        return [0]

    def _try_open_webcam_source(self, source: int | str) -> bool:
        backends: list[tuple[str, int]] = [("default", cv2.CAP_ANY)]
        if platform.system() == "Linux":
            backends = [("v4l2", cv2.CAP_V4L2), ("default", cv2.CAP_ANY)]

        for label, api in backends:
            cap = cv2.VideoCapture(source, api) if api != cv2.CAP_ANY else cv2.VideoCapture(source)
            if not cap.isOpened():
                cap.release()
                continue

            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            cap.set(cv2.CAP_PROP_FPS, self.fps)

            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or self.width)
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or self.height)

            warmed = False
            for _ in range(40):
                ok, frame = cap.read()
                if ok and frame is not None and frame.size > 0:
                    warmed = True
                    break
                time.sleep(0.05)

            if not warmed:
                self._last_error = f"{label}: opened but no frames"
                cap.release()
                continue

            self._cap = cap
            self.width = width
            self.height = height
            return True

        self._last_error = f"failed to open {source!r}"
        return False


class _FfmpegFrameReader:
    """Read decoded BGR frames from an FFmpeg RTSP subprocess."""

    def __init__(
        self,
        stream_url: str,
        width: int,
        height: int,
        fps: int,
        transport: Optional[str] = "tcp",
    ):
        self.stream_url = stream_url
        self.width = width
        self.height = height
        self.fps = fps
        self.transport = transport
        self.process: Optional[subprocess.Popen] = None
        self.last_error = ""
        self._frame_size = width * height * 3
        self._stderr_lines: list[str] = []

    def start(self, connect_timeout: float = 15.0) -> bool:
        loglevel = ffmpeg_loglevel()
        args = [
            "ffmpeg",
            "-y",
            "-loglevel",
            loglevel,
        ]

        local_addr = os.getenv("RTSP_LOCAL_ADDR", "").strip()
        if local_addr:
            args += ["-localaddr", local_addr]

        if self.transport in ("tcp", "udp"):
            args += ["-rtsp_transport", self.transport]

        args += [
            "-i",
            self.stream_url,
            "-an",
            "-vf",
            f"scale={self.width}:{self.height}",
            "-r",
            str(self.fps),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "pipe:1",
        ]

        try:
            self.process = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as exc:
            self.last_error = str(exc)
            return False

        if loglevel in ("quiet", "panic", "fatal", "error"):
            threading.Thread(target=self._drain_stderr, daemon=True).start()
        else:
            threading.Thread(
                target=_log_ffmpeg_stderr,
                args=(self.process, "FFmpeg RTSP"),
                daemon=True,
            ).start()

        deadline = time.monotonic() + connect_timeout
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.last_error = (
                    self._format_stderr()
                    or f"FFmpeg exited with code {self.process.returncode}"
                )
                return False

            if self._read_frame(blocking=False) is not None:
                return True
            time.sleep(0.2)

        self.last_error = self._format_stderr() or (
            f"Timed out connecting to RTSP stream ({_host_from_url(self.stream_url)})"
        )
        self.stop()
        return False

    def read(self) -> Optional[np.ndarray]:
        if not self.process or self.process.poll() is not None:
            if self.process and self.process.poll() is not None:
                self.last_error = (
                    self._format_stderr()
                    or f"FFmpeg exited with code {self.process.returncode}"
                )
            return None
        return self._read_frame(blocking=True)

    def stop(self):
        if not self.process:
            return

        if self.process.stdout:
            try:
                self.process.stdout.close()
            except OSError:
                pass

        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)

        self.process = None

    def _read_frame(self, blocking: bool) -> Optional[np.ndarray]:
        if not self.process or not self.process.stdout:
            return None

        raw = self.process.stdout.read(self._frame_size) if blocking else self._read_available()
        if not raw or len(raw) != self._frame_size:
            return None

        return np.frombuffer(raw, dtype=np.uint8).reshape((self.height, self.width, 3))

    def _read_available(self) -> bytes:
        if not self.process or not self.process.stdout:
            return b""

        import select

        fd = self.process.stdout.fileno()
        ready, _, _ = select.select([fd], [], [], 0.2)
        if not ready:
            return b""

        return self.process.stdout.read(self._frame_size)

    def _drain_stderr(self):
        if not self.process or not self.process.stderr:
            return

        for line in self.process.stderr:
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                self._stderr_lines.append(text)

    def _format_stderr(self) -> str:
        if not self._stderr_lines:
            return ""
        return " | ".join(self._stderr_lines[-3:])


def _host_from_url(stream_url: str) -> str:
    try:
        return urlparse(stream_url).hostname or stream_url
    except Exception:
        return stream_url
