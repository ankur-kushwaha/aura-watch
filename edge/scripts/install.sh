#!/bin/bash

# Single-line installer for Aura Watch AI - Edge Agent
set -e

AGENT_STARTED=false

# Helper function to check command existence
check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

resolve_python() {
    if check_command python3; then
        echo "python3"
    elif check_command python; then
        echo "python"
    else
        return 1
    fi
}

derive_ws_url() {
    local http_url="$1"
    case "$http_url" in
        https://*) echo "${http_url/https:\/\//wss://}" ;;
        http://*)  echo "${http_url/http:\/\//ws://}" ;;
        *)         echo "ws://localhost:5000" ;;
    esac
}

start_agent_background() {
    local edge_dir="$1"
    local python_cmd="$2"
    cd "$edge_dir"
    nohup "$python_cmd" main.py >> agent.log 2>&1 &
    echo $! > agent.pid
    AGENT_STARTED=true
    echo "   ✅ Edge Agent started in background (PID $(cat agent.pid))"
    echo "      Logs: $edge_dir/agent.log"
}

# Non-interactive when CLOUD_URL is passed (e.g. from dashboard copy command)
NONINTERACTIVE=false
if [ -n "${CLOUD_URL:-}" ]; then
    NONINTERACTIVE=true
fi

# Clear screen and print banner
clear
echo "========================================================================="
echo " 👁️  Aura Watch AI - Edge Agent Interactive Installer"
echo "========================================================================="
echo ""

# 1. Prerequisites Check
echo "🔍 Checking system prerequisites..."

# Node.js
if check_command node; then
    NODE_VERSION=$(node -v)
    echo "  ✅ Node.js: Installed ($NODE_VERSION)"
else
    echo "  ❌ Node.js: Not installed. Please install Node.js (version 18+) first."
    exit 1
fi

# NPM
if check_command npm; then
    NPM_VERSION=$(npm -v)
    echo "  ✅ npm: Installed ($NPM_VERSION)"
else
    echo "  ❌ npm: Not installed."
    exit 1
fi

# Python 3
PYTHON_CMD=""
if PYTHON_CMD=$(resolve_python); then
    PYTHON_VERSION=$("$PYTHON_CMD" --version 2>&1)
    echo "  ✅ Python 3: Installed ($PYTHON_VERSION via $PYTHON_CMD)"
else
    echo "  ❌ Python 3: Not installed. Please install Python 3.10+ first."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "     sudo apt install python3 python3-pip"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "     brew install python3"
    fi
    exit 1
fi

# Git
if check_command git; then
    echo "  ✅ Git: Installed"
else
    echo "  ❌ Git: Not installed. Please install Git first."
    exit 1
fi

# FFmpeg
if check_command ffmpeg; then
    echo "  ✅ FFmpeg: Installed"
else
    echo "  ⚠️  FFmpeg: Not detected. FFmpeg is required to pipe camera streams."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "     You can install it later using: sudo apt install ffmpeg"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "     You can install it later using: brew install ffmpeg"
    fi
fi
echo ""

# 2. Target Directory Selection
DEFAULT_INSTALL_DIR="${INSTALL_DIR:-$HOME/aura-watch-edge}"
if [ "$NONINTERACTIVE" = true ]; then
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    echo "📂 Install directory: $INSTALL_DIR"
else
    echo "📂 Where would you like to install the Edge Agent?"
    read -p "Install directory [$DEFAULT_INSTALL_DIR]: " INSTALL_DIR </dev/tty
    INSTALL_DIR=${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}
fi

# Resolve directory path
INSTALL_DIR=$(eval echo "$INSTALL_DIR")
mkdir -p "$INSTALL_DIR"

# 3. Clone Repository
echo "📥 Cloning Aura Watch AI repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "   Existing repository found at $INSTALL_DIR. Pulling latest changes..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone https://github.com/ankur-kushwaha/aura-watch.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/edge"

# 4. Configuration Inputs
echo ""
echo "⚙️  Configuring your Edge Agent..."
echo "----------------------------------"

DEFAULT_CLOUD_URL="${CLOUD_URL:-http://localhost:5000}"
if [ "$NONINTERACTIVE" = true ]; then
    CLOUD_URL="$DEFAULT_CLOUD_URL"
    echo "   Cloud Hub HTTP URL: $CLOUD_URL"
else
    read -p "Cloud Hub HTTP URL [$DEFAULT_CLOUD_URL]: " CLOUD_URL_INPUT </dev/tty
    CLOUD_URL=${CLOUD_URL_INPUT:-$DEFAULT_CLOUD_URL}
fi

if [ -n "${CLOUD_WS_URL:-}" ]; then
    :
elif [ "$NONINTERACTIVE" = true ]; then
    CLOUD_WS_URL=$(derive_ws_url "$CLOUD_URL")
else
    DEFAULT_CLOUD_WS_URL=$(derive_ws_url "$CLOUD_URL")
    read -p "Cloud Hub WebSocket URL [$DEFAULT_CLOUD_WS_URL]: " CLOUD_WS_URL_INPUT </dev/tty
    CLOUD_WS_URL=${CLOUD_WS_URL_INPUT:-$DEFAULT_CLOUD_WS_URL}
fi
echo "   Cloud Hub WebSocket URL: $CLOUD_WS_URL"

HOST_LABEL=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "Edge Device")
DEFAULT_DEVICE_NAME="${DEVICE_NAME:-$HOST_LABEL}"
if [ "$NONINTERACTIVE" = true ]; then
    DEVICE_NAME="$DEFAULT_DEVICE_NAME"
    echo "   Device Name: $DEVICE_NAME"
else
    read -p "Device Name [$DEFAULT_DEVICE_NAME]: " DEVICE_NAME_INPUT </dev/tty
    DEVICE_NAME=${DEVICE_NAME_INPUT:-$DEFAULT_DEVICE_NAME}
fi

# Create .env config file
cat <<EOT > .env
CLOUD_URL=$CLOUD_URL
CLOUD_WS_URL=$CLOUD_WS_URL
DEVICE_NAME="$DEVICE_NAME"
LOCAL_VIDEO_DIR=./storage/temp_clips

# Gemini Video Upload Optimization Settings
GEMINI_OPTIMIZE=true
GEMINI_OPTIMIZE_FPS=1
GEMINI_OPTIMIZE_RESOLUTION=640:480
GEMINI_OPTIMIZE_CRF=28

# Control whether verbose FFmpeg output/errors are logged in the console (true/false)
DEBUG_LOGS=false
EOT

echo "   ✅ Generated configuration file: $INSTALL_DIR/edge/.env"
echo ""

# Create .device-id file
echo "🆔 Generating Device ID from hardware/CPU serial..."
DEVICE_ID=""

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    DEVICE_ID=$(ioreg -rd1 -c IOPlatformExpertDevice | awk -F'"' '/IOPlatformSerialNumber/ {print $4}')
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if [ -f /proc/cpuinfo ]; then
        # Try Raspberry Pi serial number
        DEVICE_ID=$(awk '/Serial/ {print $3}' /proc/cpuinfo)
    fi
    
    # If not found (e.g., standard PC/VM), try reading DMI system/product serial
    if [ -z "$DEVICE_ID" ] && [ -f /sys/class/dmi/id/product_serial ]; then
        DEVICE_ID=$(cat /sys/class/dmi/id/product_serial 2>/dev/null || true)
    fi
    
    if [ -z "$DEVICE_ID" ] && [ -f /sys/class/dmi/id/board_serial ]; then
        DEVICE_ID=$(cat /sys/class/dmi/id/board_serial 2>/dev/null || true)
    fi
fi

# Trim whitespace
DEVICE_ID=$(echo "$DEVICE_ID" | xargs)

# If empty or placeholder/generic serial, fall back to random
if [ -z "$DEVICE_ID" ] || [ "$DEVICE_ID" = "None" ] || [ "$DEVICE_ID" = "0000000000000000" ] || [ "$DEVICE_ID" = "System Serial Number" ] || [ "$DEVICE_ID" = "Not Specified" ]; then
    RANDOM_ID=$(head /dev/urandom | tr -dc a-z0-9 | head -c 16 || true)
    if [ -z "$RANDOM_ID" ]; then
        RANDOM_ID="edge_\$(date +%s)_\$RANDOM"
    fi
    DEVICE_ID="edge_$RANDOM_ID"
    echo "   ⚠️  Could not retrieve hardware serial number. Generated random ID: $DEVICE_ID"
else
    # Clean up serial number (remove non-alphanumeric, prefix with edge_)
    CLEAN_ID=$(echo "$DEVICE_ID" | tr -dc 'a-zA-Z0-9_-')
    DEVICE_ID="edge_$CLEAN_ID"
    echo "   ✅ Found hardware serial number: $DEVICE_ID"
fi

echo "$DEVICE_ID" > .device-id
echo "   ✅ Saved Device ID to $INSTALL_DIR/edge/.device-id"
echo ""

# 5. Build and Installation
echo "📦 Installing npm dependencies..."
npm install --omit=dev
echo "   ✅ npm dependencies installed."
echo ""

echo "🐍 Installing Python dependencies..."
"$PYTHON_CMD" -m pip install -r requirements.txt
echo "   ✅ Python dependencies installed."
echo ""

# 6. Start Edge Agent
EDGE_DIR="$INSTALL_DIR/edge"

if [ "$NONINTERACTIVE" = true ]; then
    echo "🚀 Starting Edge Agent (non-interactive mode)..."
    start_agent_background "$EDGE_DIR" "$PYTHON_CMD"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "📋 Linux system detected."
    read -p "Would you like to install the Edge Agent as a systemd background service? (y/n) [y]: " REGISTER_SERVICE </dev/tty
    REGISTER_SERVICE=${REGISTER_SERVICE:-y}

    if [[ "$REGISTER_SERVICE" =~ ^[Yy]$ ]]; then
        echo "⚙️  Running daemon registration..."
        chmod +x scripts/setup-service.sh
        if ./scripts/setup-service.sh; then
            AGENT_STARTED=true
            echo "   ✅ Edge Agent registered as systemd service and started."
        else
            echo "   ⚠️  Systemd setup failed. You can start the agent manually."
        fi
    fi
else
    echo "ℹ️  Systemd service registration is only supported on Linux (Raspberry Pi/Jetson)."
fi

if [ "$AGENT_STARTED" = false ]; then
    read -p "Start the Edge Agent now in the background? (y/n) [y]: " START_NOW </dev/tty
    START_NOW=${START_NOW:-y}
    if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
        echo "🚀 Starting Edge Agent..."
        start_agent_background "$EDGE_DIR" "$PYTHON_CMD"
    fi
fi

echo ""
echo "========================================================================="
echo " 🎉 Aura Watch AI - Edge Agent Installed Successfully!"
echo "========================================================================="
echo ""
if [ "$AGENT_STARTED" = true ]; then
    echo "The agent is running and will register with your Cloud Hub at:"
    echo "   $CLOUD_URL"
    echo "It should appear in your dashboard within a few seconds."
    echo ""
fi
echo "To run the agent manually in the foreground:"
echo "   cd $EDGE_DIR"
echo "   $PYTHON_CMD main.py"
echo ""
if [ -f "$EDGE_DIR/agent.pid" ]; then
    echo "To stop the background agent:"
    echo "   kill \$(cat $EDGE_DIR/agent.pid)"
    echo ""
fi
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "To manage the systemd background service (if installed):"
    echo "   sudo systemctl status aura-watch-edge.service"
    echo "   sudo systemctl restart aura-watch-edge.service"
    echo ""
fi
echo "========================================================================="
