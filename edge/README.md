# Aura Watch AI — Edge Surveillance Agent

Lightweight Python agent for edge devices (Raspberry Pi, NVIDIA Jetson, macOS dev machines). It uses **cheap motion detection** while idle, records event clips with pre-roll, then runs **YOLOv8 nano + ByteTrack** and **OSNet ReID** on each finished clip before upload. Live preview is optional and does not run YOLO.

**Node.js is not required on the edge device** — only Python 3.10+, Git, and FFmpeg.

---

## WiFi Provisioning (headless Raspberry Pi)

Two complementary mechanisms let you connect a headless Pi to a new WiFi network without a screen.

### Method 1: AP Fallback (automatic on boot)

When the Pi boots and **cannot connect to WiFi within 30 seconds**, it automatically creates a temporary hotspot:

1. A hotspot named **`AuraWatch-XXXX`** (last 4 chars of device ID) appears in your phone's WiFi list
2. Connect your phone (or laptop) to it — no password required
3. A browser may auto-open. If not, navigate to **`http://192.168.4.1`**
4. The captive portal shows nearby networks — pick yours, enter the password, and press **Connect**
5. The Pi applies the credentials, tears down the hotspot, and reboots into normal operation

The AP times out after **15 minutes** and reboots if nobody configures it.

> **Requires**: `hostapd`, `dnsmasq` (auto-installed by `setup-service.sh`), and NetworkManager or wpa_supplicant.

### Method 2: Hub-Pushed WiFi (from the dashboard)

When the Pi is online via **Ethernet** (or already on WiFi), you can push new credentials from the Aura Watch dashboard:

1. Open the **Device Settings** dialog for your device in the dashboard
2. Scroll to the **WiFi Configuration** section
3. Enter the SSID and password → click **Apply WiFi Now**
4. The credentials are encrypted (AES-256-GCM) and stored in the cloud
5. A `set_wifi` command is sent to the device over the existing WebSocket
6. The Pi connects to the new network immediately — you can then unplug Ethernet

If the device is **offline** when you apply, the credentials are saved and will be pushed on next reconnect, or applied by the AP portal on boot.

**Backend setup** — add to `backend/.env`:
```bash
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
WIFI_CREDENTIAL_SECRET="your-64-char-hex-secret"
```

### Which to use?

| Scenario | Method |
|---|---|
| First-time setup in a new location | AP Fallback (automatic) |
| Changing WiFi from the office | Hub-Pushed from dashboard |
| Pre-configuring before deployment | Raspberry Pi Imager (Advanced Options → WiFi) |

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
7. On **Linux**, optionally installs **Tailscale** for remote SSH access to the device

**Remote access (Tailscale):**

Set a reusable auth key on the Cloud Hub (`TAILSCALE_AUTH_KEY` in backend `.env`). The dashboard install command will include it automatically. Each device joins your tailnet with Tailscale SSH enabled.

```bash
# Hub .env
TAILSCALE_AUTH_KEY=tskey-auth-xxxxxxxxxxxx

# Or pass manually on install
TAILSCALE_AUTH_KEY='tskey-auth-...' CLOUD_URL='https://...' sh -c "$(curl -fsSL .../install.sh)"
```

After install, SSH to a device from any machine on your tailnet:

```bash
ssh pi@100.x.x.x          # Tailscale IP (shown in Device Metrics)
ssh pi@aura-office-edge   # MagicDNS hostname
```

Generate keys at [Tailscale admin → Settings → Keys](https://login.tailscale.com/admin/settings/keys). Use a **reusable** key for fleet installs.

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

### ReID (OSNet on edge)

Person/vehicle ReID profiles are created **on the edge device** using `models/osnet_x1_0.onnx`. The cloud hub stores the crop JPEG plus the 512-dim embedding vector in Qdrant — it does not run OSNet.

Ensure the model exists at `edge/models/osnet_x1_0.onnx` (shipped in the repo). Override with `REID_MODEL_PATH` if needed.

---

## Performance optimization

PyTorch `.pt` models work for development but are very CPU-heavy and slower on edge hardware. On a Raspberry Pi, running YOLOv8n directly from PyTorch CPU will peg all 4 cores at 100%, causing the system to throttle and starve the camera/WebSocket threads. 

**Always export the model once to a platform-optimized format; the agent auto-loads it when the file exists.**

| Hardware | Format | Export command | Typical FPS gain |
|----------|--------|----------------|------------------|
| **Raspberry Pi** (ARM) | ONNX | `.venv/bin/python scripts/export_model.py onnx` | ~1.5–2× |
| **Apple Silicon Mac** | CoreML | `.venv/bin/python scripts/export_model.py coreml` | ~2–3× |
| **NVIDIA Jetson** | TensorRT | `.venv/bin/python scripts/export_model.py engine` | ~2×+ |
| **Intel NUC / x86** | OpenVINO | `.venv/bin/python scripts/export_model.py openvino` | ~1.5–2× |

> **Note:** TensorRT and OpenVINO do not apply to Raspberry Pi. Use **ONNX** on Pi.

### Step-by-Step Optimization for Raspberry Pi

#### 1. Export YOLO to ONNX
The installer does **not** run model export automatically. Do this once after install:

```bash
cd ~/aura-watch-edge/edge   # or your edge directory

# One-time export deps (ultralytics + PyTorch) — not in requirements-pi.txt
.venv/bin/pip install -r requirements-export.txt

# IMPORTANT: Use the virtual environment's python to avoid ModuleNotFoundError
.venv/bin/python scripts/export_model.py onnx
```

If you prefer to run it using `python3`, you must activate the virtual environment first:
```bash
source .venv/bin/activate
python3 scripts/export_model.py onnx
deactivate
```

#### 2. Prevent CPU Thread Starvation (High Priority)
By default, PyTorch and ONNX Runtime spawn as many threads as there are CPU cores (usually 4). When background YOLO/ReID inference runs on a new clip, they will consume 100% CPU, starving the primary camera capture and cloud WebSocket threads. This causes `camera_stall` (no frame for 45s) and WebSocket connection drops.

Limit the thread pools by adding the following lines to your `.env` file on the Pi:
```env
# Limit deep learning libraries to a single execution thread
OMP_NUM_THREADS=1
OPENBLAS_NUM_THREADS=1
MKL_NUM_THREADS=1
VECLIB_MAXIMUM_THREADS=1
NUMEXPR_NUM_THREADS=1
```

#### 3. Quick `.env` Tuning
You can also adjust parameters directly in your `.env` file to lower the overall processing overhead:
```env
# Use low resolution/substream from camera to reduce FFmpeg resizing CPU overhead
CAMERA_WIDTH=640
CAMERA_HEIGHT=480

# Use a smaller YOLO image size for faster inference (320 or 416)
YOLO_IMGSZ=320

# Run full YOLO detection every N frames; intermediate frames reuse last bounding boxes
YOLO_DETECT_INTERVAL=3

# Limit live preview frame rate
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
sh scripts/setup-service.sh
```

**Useful commands:**

```bash
sudo systemctl status aura-watch-edge.service
sudo systemctl restart aura-watch-edge.service
sudo journalctl -u aura-watch-edge.service -f
```

**Remote update from the cloud dashboard** force-pulls the latest code (`git fetch` + `git reset --hard`), refreshes Python dependencies, re-installs the systemd unit from `scripts/aura-watch-edge.service.template`, and restarts the agent. Devices that were installed before this feature need a **one-time** re-run of `sh scripts/setup-service.sh` on the Pi so passwordless `refresh-systemd-service.sh` is allowed in sudoers.

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
4. **System Status Logs (dashboard)** — with a stream selected, the left panel shows live edge events (camera stalls, WebSocket reconnects, clip activity). Errors are highlighted in red.
5. **Device Logs modal** — click **Logs** on the edge device for journalctl history plus live agent logs.
6. **On the Pi** — follow the agent in real time:

```bash
sudo journalctl -u aura-watch-edge.service -f
```

Look for `[Detector Error] Camera stream lost`, `[Edge WS] Connection error`, or `Failed to open camera`. The agent auto-reconnects the camera and cloud WebSocket; after code updates, restart once: `sudo systemctl restart aura-watch-edge.service`.

**Common causes on Pi + Tapo RTSP:** camera stopped sending frames (Wi‑Fi/power), stale FFmpeg after a stall (`pkill -f "ffmpeg.*<camera-ip>"` then restart service), or cloud WebSocket ping timeout while CPU is busy encoding a clip.

### Missing logs / long gaps in journalctl

Under systemd, Python stdout used to be **fully buffered**, so clip and error logs could sit in memory for hours and only appear in `journalctl` after a burst of activity or a restart. The agent now:

- Runs with `PYTHONUNBUFFERED=1` and `-u`
- Flushes every log line immediately
- Writes a **persistent** `storage/agent.log` on disk (survives restarts)
- Emits a `[Health]` heartbeat every 5 minutes (configurable via `HEALTH_HEARTBEAT_SEC`)

To inspect the durable log on the device:

```bash
tail -f ~/aura-watch-edge/edge/storage/agent.log
```

The dashboard **Logs** button returns both `agent.log` and the systemd journal.

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

Prefer the **Update** button in the cloud dashboard (same steps as below).

Manual equivalent:

```bash
cd ~/aura-watch-edge && git pull
sh edge/scripts/setup-venv.sh edge python3
sudo edge/scripts/refresh-systemd-service.sh   # or ./edge/scripts/setup-service.sh
```

---

## Scripts reference

| Script | Purpose |
|--------|---------|
| `scripts/install.sh` | Full interactive / one-line installer |
| `scripts/setup-tailscale.sh` | Install Tailscale and join tailnet for remote SSH |
| `scripts/setup-venv.sh` | Create `.venv` and install Python deps |
| `scripts/setup-service.sh` | Register systemd service (Linux) |
| `scripts/refresh-systemd-service.sh` | Re-apply systemd unit from template (sudo) |
| `scripts/export_model.py` | Export YOLO to ONNX / CoreML / TensorRT / OpenVINO |
| `scripts/wifi-ap-setup.sh` | Boot-time WiFi check → AP hotspot fallback if no WiFi |
| `scripts/wifi_portal.py` | Captive portal HTTP server (runs during AP mode) |
| `scripts/aura-watch-wifi-setup.service` | Systemd oneshot unit for WiFi provisioning on boot |
