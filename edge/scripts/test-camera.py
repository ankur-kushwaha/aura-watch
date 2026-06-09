#!/usr/bin/env python3
"""Test which camera capture method works on this device (especially Raspberry Pi CSI)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from camera import CameraCapture


def run_shell(cmd: list[str], timeout: float = 8.0) -> tuple[int, str]:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = (result.stdout or "") + (result.stderr or "")
        return result.returncode, output.strip()
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    except FileNotFoundError:
        return 127, "command not found"


def main() -> None:
    device = sys.argv[1] if len(sys.argv) > 1 else "/dev/video0"
    print("=== Aura Watch Camera Diagnostic ===")
    print(f"Device: {device}\n")

    print("-- v4l2-ctl --list-devices --")
    code, out = run_shell(["v4l2-ctl", "--list-devices"])
    print(out or f"exit {code}")
    print()

    if os.path.exists(device):
        print(f"-- v4l2-ctl -d {device} --list-formats-ext --")
        _, out = run_shell(["v4l2-ctl", "-d", device, "--list-formats-ext"])
        print(out or "(no output)")
        print()

    for cmd in ("rpicam-hello", "libcamera-hello"):
        if shutil.which(cmd):
            print(f"-- {cmd} --timeout 2000 --")
            code, out = run_shell([cmd, "--timeout", "2000"], timeout=5)
            print("OK" if code == 0 else f"failed ({code})")
            if out:
                print(out.splitlines()[-1] if out else "")
            print()
            break

    for fmt in ("yuyv422", "mjpeg", None):
        args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "v4l2"]
        if fmt:
            args += ["-input_format", fmt]
        args += [
            "-video_size",
            "640x480",
            "-i",
            device,
            "-frames:v",
            "3",
            "-f",
            "null",
            "-",
        ]
        label = fmt or "auto"
        print(f"-- ffmpeg V4L2 ({label}) --")
        code, out = run_shell(args, timeout=10)
        print("OK" if code == 0 else f"failed ({code}): {out[:200]}")
        print()

    for stream_url in (device, "0"):
        print(f"-- CameraCapture stream_url={stream_url!r} --")
        camera = CameraCapture(stream_url=stream_url)
        if camera.open():
            frame = camera.read()
            if frame is not None:
                print(f"OK — frame shape {frame.shape[1]}x{frame.shape[0]}")
            else:
                print("opened but read() returned None")
            camera.release()
        else:
            print(f"FAILED — {camera.last_error}")
        print()

    print("If CameraCapture failed, set dashboard stream URL to:", device)


if __name__ == "__main__":
    main()
