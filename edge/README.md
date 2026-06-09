# Aura Watch AI - Edge Surveillance Agent

This folder contains the lightweight edge surveillance agent script designed to run locally on your edge devices (such as a Raspberry Pi, Nvidia Jetson, or developer computers). 

The edge agent runs YOLOv8 nano object detection with ByteTrack, streams annotated live video via HLS, pushes annotated preview frames to the cloud, uploads detection-triggered video clips to the Cloud Hub, and connects via WebSockets to receive configurations in real-time.

## Prerequisites

Ensure the following are installed on your edge device:
1. **Python 3.10+**
2. **Git** (required by the one-line installer to clone the repo)
3. **FFmpeg** (used for HLS encoding and video clip recording)
   - On Debian/Ubuntu/Raspberry Pi OS: `sudo apt install ffmpeg`
   - On macOS: `brew install ffmpeg`

If Python is missing, install it for your OS:

| OS | Command |
|----|---------|
| **Raspberry Pi / Debian / Ubuntu** | `sudo apt update && sudo apt install -y python3 python3-venv python3-full` |
| **Fedora / RHEL / Rocky** | `sudo dnf install -y python3 python3-pip` |
| **Arch Linux** | `sudo pacman -S --needed python python-pip` |
| **macOS** | `brew install python3` or [python.org/downloads](https://www.python.org/downloads/macos/) |

Verify with: `python3 --version` (must show 3.10 or newer).

## Installation

### Method A: Single-Line Interactive Installer (Recommended)
You can download, configure, start, and register the agent in a single command. When copied from the dashboard UI, the Cloud Hub URL is pre-filled automatically:
```bash
CLOUD_URL='https://your-hub.example.com' sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"
```

Or run interactively (you will be prompted for the Cloud Hub URL):
```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"
```

### Method B: Manual Installation
1. Copy this `edge/` folder to your edge device.
2. Create a virtual environment and install dependencies (required on Raspberry Pi OS / Debian due to PEP 668):
   ```bash
   chmod +x scripts/setup-venv.sh
   sh scripts/setup-venv.sh . python3
   ```
   On Raspberry Pi, if venv creation fails, install: `sudo apt install -y python3-venv python3-full`

## Configuration

Create a `.env` file inside this directory (you can copy `.env.example` as a template):
```bash
cp .env.example .env
```

Set the following options in your `.env`:
* `CLOUD_URL`: The HTTP URL of your Cloud Hub backend (e.g. `https://aura-watch.adboardtools.com` or `http://192.168.1.100:5000`). WebSocket URL is derived automatically (`https` → `wss`, `http` → `ws`).
* `DEVICE_NAME`: A descriptive name for this specific edge camera device (e.g., "Front Door", "Warehouse Jetson").

## Running the Agent

### macOS + RTSP cameras (important)

If VLC and `ping` work in **Terminal.app** but the edge agent fails with `No route to host` inside **Cursor's integrated terminal**, macOS is blocking Cursor from **Local Network** access.

**Fix:** System Settings → Privacy & Security → **Local Network** → enable **Cursor**, then restart Cursor.

**Workaround:** Run the edge agent from an external Terminal window instead:

```bash
cd edge && .venv/bin/python main.py
```

### Development / Local Run
To run the agent in the foreground:
```bash
.venv/bin/python main.py
```

From the monorepo root (requires Node.js only for the npm wrapper):
```bash
npm run edge
```

## Running on Boot (Linux Systemd)

For Raspberry Pi or Jetson devices, we provide a setup script that registers the agent as a systemd background service that automatically launches when the device boots.

To install and start the background daemon:
```bash
chmod +x scripts/setup-service.sh
./scripts/setup-service.sh
```

### Useful Commands
- **Check Status**: `sudo systemctl status aura-watch-edge.service`
- **Stop Service**: `sudo systemctl stop aura-watch-edge.service`
- **Start Service**: `sudo systemctl start aura-watch-edge.service`
- **View Live Logs**: `sudo journalctl -u aura-watch-edge.service -f`
