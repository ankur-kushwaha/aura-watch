#!/bin/bash

# Setup script for Aura Watch AI Edge Service (Linux Systemd)
set -e

echo "=== Aura Watch AI Edge Agent Setup ==="

# 1. Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "Warning: This setup script is intended for Linux (Raspberry Pi/Jetson). On macOS, please run 'npm run dev' or 'npm start' directly."
    exit 1
fi

# 2. Check for node and npm
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js (version >= 18) first."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed."
    exit 1
fi

# 3. Check for FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "Warning: FFmpeg is not installed. It is required to grab video frames and record clips. Please install it: sudo apt install ffmpeg"
fi

# Get directories and user details
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
USER_NAME=$(logname || echo $USER)
NODE_PATH=$(which node)

echo "Installing npm dependencies..."
cd "$DIR"
npm install

echo "Compiling TypeScript codebase..."
npm run build

echo "Generating systemd service file..."
SERVICE_TEMPLATE="$DIR/scripts/aura-watch-edge.service.template"
SERVICE_OUT="/etc/systemd/system/aura-watch-edge.service"

if [ ! -f "$SERVICE_TEMPLATE" ]; then
    echo "Error: Template file not found: $SERVICE_TEMPLATE"
    exit 1
fi

# Replace placeholders dynamically
sudo sed -e "s|__USER__|${USER_NAME}|g" \
         -e "s|__DIR__|${DIR}|g" \
         -e "s|__NODE__|${NODE_PATH}|g" \
         "$SERVICE_TEMPLATE" | sudo tee "$SERVICE_OUT" > /dev/null

echo "Registering systemd daemon..."
sudo systemctl daemon-reload
sudo systemctl enable aura-watch-edge.service

echo "Starting systemd service..."
sudo systemctl start aura-watch-edge.service

echo "=== Setup Completed Successfully ==="
echo "The Edge Agent is now running in the background and will start automatically on boot."
echo "You can check status using: sudo systemctl status aura-watch-edge.service"
echo "You can view logs using: sudo journalctl -u aura-watch-edge.service -f"
