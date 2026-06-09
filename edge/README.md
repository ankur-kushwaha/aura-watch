# Aura Watch AI — Edge Surveillance Agent

Lightweight Python agent for edge devices (Raspberry Pi, NVIDIA Jetson, macOS dev machines). It runs **YOLOv8 nano + ByteTrack** for person/vehicle detection, pushes annotated preview frames to the cloud over WebSocket, encodes detection-triggered clips on demand (no 24/7 video encoding), uploads them to the Cloud Hub, and receives configuration updates in real time.

**Node.js is not required on the edge device** — only Python 3.10+, Git, and FFmpeg.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Python 3.10+** | Required |
| **Git** | Required by the one-line installer |
| **FFmpeg** | On-demand clip encoding (only while objects are detected) |

### Install Python by OS

| OS | Command |
|----|---------|
| **Raspberry Pi / Debian / Ubuntu** | `sudo apt update && sudo apt install -y python3 python3-venv python3-full` |
| **Fedora / RHEL / Rocky** | `sudo dnf install -y python3 python3-pip` |
| **Arch Linux** | `sudo pacman -S --needed python python-pip` |
| **macOS** | `brew install python3` or [python.org/downloads/macos](https://www.python.org/downloads/macos/) |

Verify: `python3 --version` (must be 3.10 or newer).

### macOS: system Python vs Homebrew

macOS ships **Python 3.9** at `/usr/bin/python3`. If Homebrew Python is installed but `python3 --version` still shows 3.9:

```bash
export PATH="/opt/homebrew/bin:$PATH"
python3 --version   # should show 3.10+
```

Add that `export` to `~/.zshrc` to make it permanent.

Install FFmpeg:

```bash
# Debian / Ubuntu / Raspberry Pi OS
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

---

## Installation

### Method A: One-line installer (recommended)

Pre-filled from the dashboard (production hub):

```bash
CLOUD_URL='https://aura-watch.adboardtools.com' sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"
```

Interactive (prompts for Cloud Hub URL and device name):

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"
```

**What the installer does:**

1. Checks prerequisites (Python 3.10+, Git, FFmpeg)
2. Clones or `git pull`s into `~/aura-watch-edge` (or your chosen directory)
3. Writes `.env` and a persistent hardware-based `.device-id`
4. Creates a Python **virtual environment** at `edge/.venv` (avoids PEP 668 / `externally-managed-environment` on Raspberry Pi OS)
5. On **ARM** (Pi): uses `requirements-pi.txt` (headless OpenCV) and installs CPU-only PyTorch first
6. Optionally registers a **systemd** service (Linux) or starts the agent in the background

**First install time (venv + dependencies):**

| Device | Typical duration |
|--------|------------------|
| Mac / desktop | 5–15 min |
| Raspberry Pi 4/5 | 20–45 min |
| Raspberry Pi 3 | 45–90+ min |

Large packages (PyTorch, OpenCV) download during install — progress is shown in the terminal.

**Re-running the installer:** pulls latest code and refreshes the venv, but **overwrites `.env`** with defaults. Back up custom settings first:

```bash
cp ~/aura-watch-edge/edge/.env ~/aura-watch-edge/edge/.env.bak
```

### Method B: Manual installation

```bash
cd edge
cp .env.example .env
chmod +x scripts/setup-venv.sh
sh scripts/setup-venv.sh . python3
.venv/bin/python main.py
```

On Raspberry Pi, if venv creation fails:

```bash
sudo apt install -y python3-venv python3-full
```

---

## Configuration

Copy and edit the environment template:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `CLOUD_URL` | Cloud Hub HTTP URL (default `https://aura-watch.adboardtools.com`). WebSocket URL is derived automatically (`https` → `wss`, `http` → `ws`). |
| `DEVICE_NAME` | Display name in the dashboard (e.g. "Front Door") |
| `YOLO_IMGSZ` | Inference size — `320` is faster on Pi, `416` is default |
| `YOLO_DETECT_INTERVAL` | Run YOLO every N frames; intermediate frames reuse last boxes |
| `CAMERA_WIDTH` / `CAMERA_HEIGHT` | Capture resolution — lower = faster |

See `.env.example` for the full list.

---

## Performance optimization

PyTorch `.pt` models work for development but are slower on edge hardware. **Export once** to a platform-optimized format; the agent auto-loads it when the file exists.

| Hardware | Format | Export command | Typical FPS gain |
|----------|--------|----------------|------------------|
| **Raspberry Pi** (ARM) | ONNX | `.venv/bin/python scripts/export_model.py onnx` | ~1.5–2× |
| **Apple Silicon Mac** | CoreML | `.venv/bin/python scripts/export_model.py coreml` | ~2–3× |
| **NVIDIA Jetson** | TensorRT | `.venv/bin/python scripts/export_model.py engine` | ~2×+ |
| **Intel NUC / x86** | OpenVINO | `.venv/bin/python scripts/export_model.py openvino` | ~1.5–2× |

> **Note:** TensorRT and OpenVINO do not apply to Raspberry Pi. Use **ONNX** on Pi.

The installer does **not** run model export automatically — do this once after install:

```bash
cd ~/aura-watch-edge/edge   # or your edge directory
.venv/bin/python scripts/export_model.py onnx   # Pi
# .venv/bin/python scripts/export_model.py coreml   # Mac
```

**Quick `.env` tuning (no export needed):**

```bash
CAMERA_WIDTH=640
CAMERA_HEIGHT=480
YOLO_IMGSZ=320
YOLO_DETECT_INTERVAL=3
FRAME_STREAM_FPS=8
```

---

## Running the agent

### Foreground

```bash
cd edge
.venv/bin/python main.py
```

From the monorepo root (npm is only a thin wrapper):

```bash
npm run edge
```

### macOS + RTSP cameras

If VLC works in Terminal.app but the agent fails with `No route to host` inside **Cursor's terminal**, enable **Local Network** for Cursor in System Settings → Privacy & Security, or run from an external Terminal:

```bash
cd edge && .venv/bin/python main.py
```

### Background on Linux (systemd)

```bash
chmod +x scripts/setup-service.sh
./scripts/setup-service.sh
```

**Useful commands:**

```bash
sudo systemctl status aura-watch-edge.service
sudo systemctl restart aura-watch-edge.service
sudo journalctl -u aura-watch-edge.service -f
```

---

## Troubleshooting

### See FFmpeg logs (camera / clip encoding debugging)

FFmpeg is used for RTSP capture and on-demand clip encoding. By default the installer sets `DEBUG_LOGS=false` (errors only). Enable verbose logs in `.env`:

```bash
DEBUG_LOGS=true
# optional — even more detail:
FFMPEG_LOGLEVEL=verbose
```

Restart the agent, then watch logs:

```bash
# foreground (best for debugging)
cd ~/aura-watch-edge/edge
.venv/bin/python main.py

# or systemd
sudo journalctl -u aura-watch-edge.service -f
```

You should see lines prefixed with `[FFmpeg clip]` (during recordings) or `[FFmpeg RTSP]`.

**Test camera directly on the Pi:**

```bash
# USB / CSI webcam
ffplay -f v4l2 -i /dev/video0

# list who is using the camera
sudo fuser -v /dev/video0

# kill stale ffmpeg from a crashed agent
pkill -f "ffmpeg.*clip_"
```

Clips are written to `storage/temp_clips/` only while objects are detected — there is no always-on segment buffer.

### Pi CSI camera (`unicam` at `/dev/video0`)

`v4l2-ctl --list-devices` should show:

```
unicam (platform:fe801000.csi):
    /dev/video0
```

Set the stream URL in the dashboard to **`libcamera`** (or **`0`** for auto-detect). Do **not** use `/dev/video0` for CSI cameras — that node exists but does not work with OpenCV/FFmpeg V4L2 on Bookworm.

Quick test on the Pi:

```bash
rpicam-vid -t 2000 --width 640 --height 480 --codec yuv420 --nopreview -n -o /dev/null
```

The agent uses **rpicam-vid** (raw YUV420) first on Pi when `rpicam-vid` is installed, then falls back to OpenCV / FFmpeg V4L2 for USB cameras.

Run the diagnostic script on the Pi:

```bash
cd ~/aura-watch-edge/edge
.venv/bin/python scripts/test-camera.py /dev/video0
```

### `Device or resource busy` on `/dev/video0` (Pi)

Another process holds the camera. Common causes: a previous agent instance, `libcamera-hello`, or a stuck FFmpeg.

```bash
sudo systemctl stop aura-watch-edge.service
pkill -f "ffmpeg.*clip_"
sudo fuser -v /dev/video0   # see PID, then: sudo kill <pid>
sudo systemctl start aura-watch-edge.service
```

On Raspberry Pi OS Bookworm, if OpenCV cannot open the camera, try the `libcamera` stack or set the stream URL in the dashboard to the correct device (e.g. `/dev/video0`).

### Live preview not updating in the dashboard

The UI uses WebSocket JPEG frames from the edge. If the feed is stuck on "Initializing Live Stream...":

1. **Edge not connected** — confirm the device shows Online in the dashboard.
2. **Preview not enabled** — the hub requests preview frames when you open a stream; check edge logs for `Low-latency preview streaming enabled`.
3. **Camera pipeline failed** — see FFmpeg logs above; trigger a detection to verify `clip_*.mp4` files appear in `storage/temp_clips/`.

### `externally-managed-environment` (Raspberry Pi OS)

Do not use system `pip`. Use the installer or `scripts/setup-venv.sh` — dependencies go into `edge/.venv`.

### Installer stuck at "Setting up Python virtual environment"

First install downloads PyTorch and OpenCV (hundreds of MB). Wait 5–45 min depending on device and network. You should see pip download progress. If cancelled, resume with:

```bash
cd ~/aura-watch-edge/edge
sh scripts/setup-venv.sh . python3
```

### `python3` is 3.9 on macOS

See [macOS: system Python vs Homebrew](#macos-system-python-vs-homebrew) above.

### Re-install after code updates

```bash
cd ~/aura-watch-edge && git pull
sh scripts/setup-venv.sh edge python3
```

---

## Scripts reference

| Script | Purpose |
|--------|---------|
| `scripts/install.sh` | Full interactive / one-line installer |
| `scripts/setup-venv.sh` | Create `.venv` and install Python deps |
| `scripts/setup-service.sh` | Register systemd service (Linux) |
| `scripts/export_model.py` | Export YOLO to ONNX / CoreML / TensorRT / OpenVINO |
