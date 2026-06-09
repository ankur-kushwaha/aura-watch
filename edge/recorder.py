"""HLS encoding, clip concatenation, transcoding, and cloud upload."""

from __future__ import annotations

import os
import queue
import re
import shutil
import subprocess
import threading
import time
from typing import Optional

import numpy as np
import requests


class HlsEncoder:
    """Pipe annotated BGR frames into FFmpeg for live HLS output."""

    def __init__(
        self,
        output_dir: str,
        width: int,
        height: int,
        fps: int = 30,
        segment_sec: float = 1.0,
    ):
        self.output_dir = output_dir
        self.width = width
        self.height = height
        self.fps = fps
        self.segment_sec = segment_sec
        self.process: Optional[subprocess.Popen] = None
        self._write_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=2)
        self._writer_thread: Optional[threading.Thread] = None
        self._stop_writer = threading.Event()
        os.makedirs(output_dir, exist_ok=True)

    def start(self):
        playlist = os.path.join(self.output_dir, "index.m3u8")
        segment_time = max(self.segment_sec, 0.5)
        args = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
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
            "-hls_time",
            str(segment_time),
            "-hls_list_size",
            "4",
            "-hls_flags",
            "delete_segments+append_list+omit_endlist",
            playlist,
        ]
        self.process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._stop_writer.clear()
        self._writer_thread = threading.Thread(
            target=self._writer_loop,
            name="hls-writer",
            daemon=True,
        )
        self._writer_thread.start()

    def write_frame(self, frame: np.ndarray):
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
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)

        self.process = None
        self._writer_thread = None


def clear_directory(directory: str):
    if not os.path.isdir(directory):
        return
    for name in os.listdir(directory):
        path = os.path.join(directory, name)
        if os.path.isfile(path):
            try:
                os.unlink(path)
            except OSError:
                pass


def kill_ffmpeg_for_dir(directory: str):
    try:
        subprocess.run(
            ["pkill", "-9", "-f", f"ffmpeg.*{directory}"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        pass


def copy_new_hls_segments(hls_dir: str, staging_dir: str, copied: set[str]) -> int:
    """Copy newly written HLS .ts segments before the rolling window deletes them."""
    os.makedirs(staging_dir, exist_ok=True)
    added = 0
    for name in os.listdir(hls_dir):
        if not name.endswith(".ts") or name in copied:
            continue
        src = os.path.join(hls_dir, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(staging_dir, name)
        try:
            shutil.copy2(src, dst)
            copied.add(name)
            added += 1
        except OSError:
            pass
    return added


def remove_directory(directory: str):
    if os.path.isdir(directory):
        shutil.rmtree(directory, ignore_errors=True)


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


def concat_hls_segments(hls_dir: str, output_mp4: str):
    abs_hls_dir = os.path.abspath(hls_dir)
    abs_output = os.path.abspath(output_mp4)
    segments: list[tuple[int, str]] = []

    for name in os.listdir(abs_hls_dir):
        if not name.endswith(".ts"):
            continue
        match = re.search(r"(\d+)\.ts$", name)
        num = int(match.group(1)) if match else 0
        segments.append((num, os.path.join(abs_hls_dir, name)))

    segments.sort(key=lambda item: item[0])
    if not segments:
        raise RuntimeError("No HLS segments found to concatenate")

    txt_path = os.path.join(abs_hls_dir, f"concat_{int(time.time() * 1000)}.txt")
    with open(txt_path, "w", encoding="utf-8") as handle:
        for _, abs_path in segments:
            if not os.path.isfile(abs_path):
                raise RuntimeError(f"HLS segment missing before concat: {abs_path}")
            escaped = abs_path.replace("'", "'\\''")
            handle.write(f"file '{escaped}'\n")

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                txt_path,
                "-c",
                "copy",
                abs_output,
            ],
            capture_output=True,
            text=True,
            check=False,
            cwd=abs_hls_dir,
        )
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg concat failed: {result.stderr}")
    finally:
        try:
            os.unlink(txt_path)
        except OSError:
            pass


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


def upload_clip(
    cloud_url: str,
    device_id: str,
    filepath: str,
    filename: str,
    duration: Optional[float] = None,
    stream_id: Optional[str] = None,
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

    with open(filepath, "rb") as handle:
        response = requests.post(url, data=handle, headers=headers, timeout=120)

    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"Upload failed ({response.status_code}): {response.text}")
