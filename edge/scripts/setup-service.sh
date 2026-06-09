#!/bin/sh

# Setup script for Aura Watch AI Edge Service (Linux Systemd)
set -e

echo "=== Aura Watch AI Edge Agent Setup ==="

if [ "$(uname -s)" != "Linux" ]; then
    echo "Warning: This setup script is intended for Linux (Raspberry Pi/Jetson)."
    echo "On macOS, run: .venv/bin/python main.py"
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: Python 3 is not installed. Please install Python 3.10+ first."
    exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "Warning: FFmpeg is not installed. It is required to grab video frames and record clips."
    echo "Install with: sudo apt install ffmpeg"
fi

DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
USER_NAME=$(logname 2>/dev/null || id -un)
VENV_SCRIPT="$DIR/scripts/setup-venv.sh"

if [ ! -x "$VENV_SCRIPT" ]; then
    chmod +x "$VENV_SCRIPT"
fi

echo "Installing Python dependencies into virtual environment..."
sh "$VENV_SCRIPT" "$DIR" python3
PYTHON_PATH="$DIR/.venv/bin/python"

echo "Generating systemd service file..."
SERVICE_TEMPLATE="$DIR/scripts/aura-watch-edge.service.template"
SERVICE_OUT="/etc/systemd/system/aura-watch-edge.service"

if [ ! -f "$SERVICE_TEMPLATE" ]; then
    echo "Error: Template file not found: $SERVICE_TEMPLATE"
    exit 1
fi

sudo sed -e "s|__USER__|${USER_NAME}|g" \
         -e "s|__DIR__|${DIR}|g" \
         -e "s|__PYTHON__|${PYTHON_PATH}|g" \
         "$SERVICE_TEMPLATE" | sudo tee "$SERVICE_OUT" > /dev/null

echo "Configuring passwordless reboot for cloud dashboard (sudoers)..."
SUDOERS_FILE="/etc/sudoers.d/aura-watch-edge-${USER_NAME}"
sudo tee "$SUDOERS_FILE" > /dev/null <<EOF
# Aura Watch — allow edge agent user to reboot from cloud dashboard (no password)
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/sbin/reboot, /sbin/reboot, /bin/systemctl reboot
EOF
sudo chmod 440 "$SUDOERS_FILE"
if ! sudo visudo -c -f "$SUDOERS_FILE" >/dev/null 2>&1; then
    echo "Warning: sudoers validation failed. Reboot from dashboard may require a password."
    sudo rm -f "$SUDOERS_FILE"
fi

echo "Registering systemd daemon..."
sudo systemctl daemon-reload
sudo systemctl enable aura-watch-edge.service

echo "Starting systemd service..."
sudo systemctl start aura-watch-edge.service

echo "=== Setup Completed Successfully ==="
echo "The Edge Agent is now running in the background and will start automatically on boot."
echo "You can check status using: sudo systemctl status aura-watch-edge.service"
echo "You can view logs using: sudo journalctl -u aura-watch-edge.service -f"
