# Aura Watch AI - Edge Surveillance Agent

This folder contains the lightweight edge surveillance agent script designed to run locally on your edge devices (such as a Raspberry Pi, Nvidia Jetson, or developer computers). 

The edge agent runs localized grayscale motion detection and video recording, streams live video frames to the cloud on-demand, uploads motion-triggered video clips to the Cloud Hub, and connects via WebSockets to receive configurations in real-time.

## Prerequisites

Ensure the following are installed on your edge device:
1. **Node.js** (version 18 or higher)
2. **FFmpeg** (used for frame piping and video clip recording)
   - On Debian/Ubuntu/Raspberry Pi OS: `sudo apt install ffmpeg`
   - On macOS: `brew install ffmpeg`

## Installation

1. Copy this `edge/` folder to your edge device.
2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Create a `.env` file inside this directory (you can copy `.env.example` as a template):
```bash
cp .env.example .env
```

Set the following options in your `.env`:
* `CLOUD_URL`: The HTTP URL of your Cloud Hub backend (e.g. `http://192.168.1.100:5000` or public cloud domain).
* `CLOUD_WS_URL`: The WebSocket URL of your Cloud Hub backend (e.g. `ws://192.168.1.100:5000` or public cloud WS domain).
* `DEVICE_NAME`: A descriptive name for this specific edge camera device (e.g., "Front Door", "Warehouse Jetson").

## Running the Agent

### Development / Local Run
To run the agent in the foreground:
```bash
npm run dev
```

### Production Build & Run
To compile the TypeScript code and run the production build:
```bash
npm run build
npm start
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
