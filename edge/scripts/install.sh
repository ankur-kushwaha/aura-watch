#!/bin/bash

# Single-line installer for Aura Watch AI - Edge Agent
set -e

# Clear screen and print banner
clear
echo "========================================================================="
echo " 👁️  Aura Watch AI - Edge Agent Interactive Installer"
echo "========================================================================="
echo ""

# Helper function to check command existence
check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

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
DEFAULT_INSTALL_DIR="$HOME/aura-watch-edge"
echo "📂 Where would you like to install the Edge Agent?"
read -p "Install directory [$DEFAULT_INSTALL_DIR]: " INSTALL_DIR </dev/tty
INSTALL_DIR=${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}

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

DEFAULT_CLOUD_URL="http://localhost:5000"
read -p "Cloud Hub HTTP URL [$DEFAULT_CLOUD_URL]: " CLOUD_URL </dev/tty
CLOUD_URL=${CLOUD_URL:-$DEFAULT_CLOUD_URL}

DEFAULT_CLOUD_WS_URL="ws://localhost:5000"
read -p "Cloud Hub WebSocket URL [$DEFAULT_CLOUD_WS_URL]: " CLOUD_WS_URL </dev/tty
CLOUD_WS_URL=${CLOUD_WS_URL:-$DEFAULT_CLOUD_WS_URL}

DEFAULT_DEVICE_NAME="Office Edge Pi"
read -p "Device Name [$DEFAULT_DEVICE_NAME]: " DEVICE_NAME </dev/tty
DEVICE_NAME=${DEVICE_NAME:-$DEFAULT_DEVICE_NAME}

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

# 5. Build and Installation
echo "📦 Installing npm dependencies & building client..."
npm install
npm run build
echo "   ✅ Build complete."
echo ""

# 6. Service Daemon (Systemd for Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "📋 Linux system detected."
    read -p "Would you like to install the Edge Agent as a systemd background service? (y/n) [y]: " REGISTER_SERVICE </dev/tty
    REGISTER_SERVICE=${REGISTER_SERVICE:-y}
    
    if [[ "$REGISTER_SERVICE" =~ ^[Yy]$ ]]; then
        echo "⚙️  Running daemon registration..."
        chmod +x scripts/setup-service.sh
        ./scripts/setup-service.sh
    fi
else
    echo "ℹ️  Systemd service registration is only supported on Linux (Raspberry Pi/Jetson)."
fi

echo ""
echo "========================================================================="
echo " 🎉 Aura Watch AI - Edge Agent Installed Successfully!"
echo "========================================================================="
echo ""
echo "To run the agent manually in the foreground:"
echo "   cd $INSTALL_DIR/edge"
echo "   npm run dev"
echo ""
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "To manage the background service:"
    echo "   sudo systemctl status aura-watch-edge.service"
    echo "   sudo systemctl restart aura-watch-edge.service"
fi
echo "========================================================================="
