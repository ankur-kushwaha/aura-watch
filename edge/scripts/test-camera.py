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


def test_rpicam_yuv() -> None:
    for cmd in ("rpicam-vid", "libcamera-vid"):
        if not shutil.which(cmd):
            continue
        print(f"-- {cmd} yuv420 (3 frames) --")
        args = [
            cmd,
            "-t",
            "2000",
            "--width",
            "640",
            "--height",
            "480",
            "--codec",
            "yuv420",
            "--nopreview",
            "-n",
            "-o",
            "-",
        ]
        try:
            proc = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            frame_size = 640 * 480 * 3 // 2
            got = 0
            while got < 3 and proc.poll() is None:
                chunk = proc.stdout.read(frame_size) if proc.stdout else b""
                if not chunk or len(chunk) != frame_size:
                    break
                got += 1
            proc.kill()
            proc.wait(timeout=2)
            if got >= 1:
                print(f"OK — read {got} frame(s)")
            else:
                err = proc.stderr.read().decode("utf-8", errors="replace")[-300:]
                print(f"failed: no full frames ({err.strip()})")
        except OSError as exc:
            print(f"failed: {exc}")
        print()
        return
    print("-- rpicam-vid yuv420 --")
    print("skipped (rpicam-vid not installed)\n")


def main() -> None:
    device = sys.argv[1] if len(sys.argv) > 1 else "/dev/video0"
    skip_hello = "--skip-hello" in sys.argv
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

    # Test libcamera capture before V4L2 (CSI cameras do not stream via V4L2)
    test_rpicam_yuv()

    for stream_url in ("libcamera", "0", device):
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

    if not skip_hello:
        for cmd in ("rpicam-hello", "libcamera-hello"):
            if shutil.which(cmd):
                print(f"-- {cmd} --timeout 2000 (last — may lock camera briefly) --")
                code, out = run_shell([cmd, "--timeout", "2000"], timeout=5)
                print("OK" if code == 0 else f"failed ({code})")
                if out:
                    print(out.splitlines()[-1] if out else "")
                print()
                break

    print(
        "Recommended dashboard stream URL for Pi CSI: libcamera (or 0 for auto-detect)"
    )


if __name__ == "__main__":
    main()
