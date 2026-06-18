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

REFRESH_SCRIPT="$DIR/scripts/refresh-systemd-service.sh"
if [ ! -f "$REFRESH_SCRIPT" ]; then
    echo "Error: refresh script not found: $REFRESH_SCRIPT"
    exit 1
fi
chmod +x "$REFRESH_SCRIPT"

echo "Generating systemd service file..."
sudo "$REFRESH_SCRIPT"

# Install WiFi AP setup service (runs once at boot to provision WiFi)
WIFI_SETUP_SRC="$DIR/scripts/aura-watch-wifi-setup.service"
WIFI_SETUP_DST="/etc/systemd/system/aura-watch-wifi-setup.service"
if [ -f "$WIFI_SETUP_SRC" ]; then
    echo "Installing WiFi provisioning service..."
    # Substitute the install path and username into the service file
    sed -e "s|%h/aura-watch-edge|$DIR/..|g" \
        -e "s|/home/%h|$HOME|g" \
        "$WIFI_SETUP_SRC" | sudo tee "$WIFI_SETUP_DST" > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable aura-watch-wifi-setup.service
    echo "   WiFi provisioning service installed and enabled."
    echo "   AP SSID: AuraWatch-<last4-of-device-id> will appear if WiFi is not configured."
else
    echo "   Note: WiFi setup service not found, skipping (optional feature)."
fi

echo "Configuring passwordless dashboard commands (sudoers)..."
SUDOERS_FILE="/etc/sudoers.d/aura-watch-edge-${USER_NAME}"
sudo tee "$SUDOERS_FILE" > /dev/null <<EOF
# Aura Watch — allow edge agent user to reboot and refresh systemd from cloud dashboard
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/sbin/reboot, /sbin/reboot, /bin/systemctl reboot, ${REFRESH_SCRIPT}
# Allow WiFi AP setup script to configure networking
${USER_NAME} ALL=(ALL) NOPASSWD: /bin/sh ${DIR}/scripts/wifi-ap-setup.sh
EOF
sudo chmod 440 "$SUDOERS_FILE"
if ! sudo visudo -c -f "$SUDOERS_FILE" > /dev/null 2>&1; then
    echo "Warning: sudoers validation failed. Reboot from dashboard may require a password."
    sudo rm -f "$SUDOERS_FILE"
fi

echo "Starting systemd service..."
sudo systemctl start aura-watch-edge.service

echo "=== Setup Completed Successfully ==="
echo "The Edge Agent is now running in the background and will start automatically on boot."
echo "You can check status using: sudo systemctl status aura-watch-edge.service"
echo "You can view logs using: sudo journalctl -u aura-watch-edge.service -f"
echo ""
echo "📡 WiFi Provisioning: If this device can't connect to WiFi on the next boot,"
echo "   it will create a hotspot. Connect to it and visit http://192.168.4.1"
echo "   to configure WiFi without a screen."
