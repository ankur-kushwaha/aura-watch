#!/bin/sh

# Single-line installer for Aura Watch AI - Edge Agent
set -e

AGENT_STARTED=false

check_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        return 1
    fi
    return 0
}

detect_os() {
    case "$(uname -s)" in
        Darwin) echo "darwin" ;;
        Linux) echo "linux" ;;
        *) echo "unknown" ;;
    esac
}

detect_linux_distro() {
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        echo "${ID:-unknown}"
    else
        echo "unknown"
    fi
}

print_python_install_help() {
    os=$(detect_os)
    echo ""
    echo "  Install Python 3.10+ for your system:"
    echo ""

    case "$os" in
        darwin)
            echo "  macOS (Homebrew — recommended):"
            echo "    brew install python3"
            echo ""
            echo "  macOS (official installer):"
            echo "    https://www.python.org/downloads/macos/"
            echo ""
            echo "  After installing, verify with: python3 --version"
            ;;
        linux)
            distro=$(detect_linux_distro)
            case "$distro" in
                debian|ubuntu|raspbian|raspberrypi|linuxmint|pop)
                    echo "  Debian / Ubuntu / Raspberry Pi OS:"
                    echo "    sudo apt update"
                    echo "    sudo apt install -y python3 python3-venv python3-full"
                    ;;
                fedora)
                    echo "  Fedora:"
                    echo "    sudo dnf install -y python3 python3-pip"
                    ;;
                rhel|centos|rocky|almalinux|ol)
                    echo "  RHEL / Rocky / AlmaLinux / CentOS:"
                    echo "    sudo dnf install -y python3 python3-pip"
                    echo "    # or on older systems: sudo yum install -y python3 python3-pip"
                    ;;
                arch|manjaro|endeavouros)
                    echo "  Arch Linux:"
                    echo "    sudo pacman -S --needed python python-pip"
                    ;;
                alpine)
                    echo "  Alpine Linux:"
                    echo "    sudo apk add python3 py3-pip"
                    ;;
                opensuse*|sles)
                    echo "  openSUSE / SLES:"
                    echo "    sudo zypper install python3 python3-pip"
                    ;;
                *)
                    echo "  Linux (pick your package manager):"
                    echo "    Debian/Ubuntu/Raspberry Pi: sudo apt install python3 python3-pip"
                    echo "    Fedora/RHEL/Rocky:          sudo dnf install python3 python3-pip"
                    echo "    Arch:                       sudo pacman -S python python-pip"
                    echo "    Alpine:                     sudo apk add python3 py3-pip"
                    ;;
            esac
            echo ""
            echo "  After installing, verify with: python3 --version"
            ;;
        *)
            echo "  Download Python 3.10+ for your platform:"
            echo "    https://www.python.org/downloads/"
            echo ""
            echo "  After installing, verify with: python3 --version"
            ;;
    esac
    echo ""
}

print_ffmpeg_install_help() {
    os=$(detect_os)
    case "$os" in
        darwin)
            echo "     macOS: brew install ffmpeg"
            ;;
        linux)
            distro=$(detect_linux_distro)
            case "$distro" in
                debian|ubuntu|raspbian|raspberrypi|linuxmint|pop)
                    echo "     Debian/Ubuntu/Raspberry Pi: sudo apt install ffmpeg"
                    ;;
                fedora|rhel|centos|rocky|almalinux|ol)
                    echo "     Fedora/RHEL/Rocky: sudo dnf install ffmpeg"
                    ;;
                arch|manjaro|endeavouros)
                    echo "     Arch: sudo pacman -S ffmpeg"
                    ;;
                alpine)
                    echo "     Alpine: sudo apk add ffmpeg"
                    ;;
                *)
                    echo "     Debian/Ubuntu: sudo apt install ffmpeg"
                    echo "     Fedora/RHEL:   sudo dnf install ffmpeg"
                    ;;
            esac
            ;;
        *)
            echo "     Install FFmpeg from https://ffmpeg.org/download.html"
            ;;
    esac
}

resolve_python() {
    # Prefer a Python 3.10+ binary (macOS /usr/bin/python3 is often 3.9.x)
    for candidate in \
        python3.14 python3.13 python3.12 python3.11 python3.10 \
        /opt/homebrew/bin/python3 /usr/local/bin/python3 \
        python3 python
    do
        if check_command "$candidate" && python_meets_minimum "$candidate"; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

python_meets_minimum() {
    python_cmd=$1
    "$python_cmd" - <<'PY' >/dev/null 2>&1
import sys
sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY
}

start_agent_background() {
    edge_dir=$1
    python_cmd=$2
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

# Python 3
PYTHON_CMD=""
if PYTHON_CMD=$(resolve_python); then
    PYTHON_VERSION=$("$PYTHON_CMD" --version 2>&1)
    echo "  ✅ Python 3: Installed ($PYTHON_VERSION via $PYTHON_CMD)"
else
  if check_command python3; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo "  ❌ Python 3: Found ($PYTHON_VERSION) but version 3.10+ is required."
    if [ "$(detect_os)" = "darwin" ]; then
      echo ""
      echo "  macOS ships python3 3.9 at /usr/bin/python3. Homebrew Python is usually newer."
      echo "  Fix your PATH, then re-run this installer:"
      echo "    export PATH=\"/opt/homebrew/bin:\$PATH\""
      echo "    python3 --version   # should show 3.10+"
      echo ""
      echo "  Or run the installer with Homebrew Python directly:"
      echo "    PATH=\"/opt/homebrew/bin:\$PATH\" sh -c \"\$(curl -fsSL .../install.sh)\""
    fi
  else
    echo "  ❌ Python 3: Not installed."
  fi
  print_python_install_help
  exit 1
fi

# Git
if check_command git; then
    echo "  ✅ Git: Installed"
else
    echo "  ❌ Git: Not installed. Please install Git first."
    os=$(detect_os)
    case "$os" in
        darwin) echo "     macOS: brew install git" ;;
        linux)
            distro=$(detect_linux_distro)
            case "$distro" in
                debian|ubuntu|raspbian|raspberrypi) echo "     sudo apt install git" ;;
                fedora|rhel|centos|rocky|almalinux) echo "     sudo dnf install git" ;;
                arch|manjaro) echo "     sudo pacman -S git" ;;
                *) echo "     Use your system package manager to install git." ;;
            esac
            ;;
        *) echo "     https://git-scm.com/downloads" ;;
    esac
    exit 1
fi

# FFmpeg
if check_command ffmpeg; then
    echo "  ✅ FFmpeg: Installed"
else
    echo "  ⚠️  FFmpeg: Not detected. FFmpeg is required to pipe camera streams."
    print_ffmpeg_install_help
fi
echo ""

# 2. Target Directory Selection
DEFAULT_INSTALL_DIR="${INSTALL_DIR:-$HOME/aura-watch-edge}"
if [ "$NONINTERACTIVE" = true ]; then
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    echo "📂 Install directory: $INSTALL_DIR"
else
    echo "📂 Where would you like to install the Edge Agent?"
    read -r -p "Install directory [$DEFAULT_INSTALL_DIR]: " INSTALL_DIR </dev/tty
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

DEFAULT_CLOUD_URL="${CLOUD_URL:-https://aura-watch.adboardtools.com}"
if [ "$NONINTERACTIVE" = true ]; then
    CLOUD_URL="$DEFAULT_CLOUD_URL"
    echo "   Cloud Hub HTTP URL: $CLOUD_URL"
else
    read -r -p "Cloud Hub HTTP URL [$DEFAULT_CLOUD_URL]: " CLOUD_URL_INPUT </dev/tty
    CLOUD_URL=${CLOUD_URL_INPUT:-$DEFAULT_CLOUD_URL}
fi

HOST_LABEL=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "Edge Device")
DEFAULT_DEVICE_NAME="${DEVICE_NAME:-$HOST_LABEL}"
if [ "$NONINTERACTIVE" = true ]; then
    DEVICE_NAME="$DEFAULT_DEVICE_NAME"
    echo "   Device Name: $DEVICE_NAME"
else
    read -r -p "Device Name [$DEFAULT_DEVICE_NAME]: " DEVICE_NAME_INPUT </dev/tty
    DEVICE_NAME=${DEVICE_NAME_INPUT:-$DEFAULT_DEVICE_NAME}
fi

# Create .env config file
cat <<EOT > .env
CLOUD_URL=$CLOUD_URL
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

if [ "$(detect_os)" = "darwin" ]; then
    DEVICE_ID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformSerialNumber/ {print $4}')
elif [ "$(detect_os)" = "linux" ]; then
    if [ -f /proc/cpuinfo ]; then
        DEVICE_ID=$(awk '/Serial/ {print $3}' /proc/cpuinfo)
    fi

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
    RANDOM_ID=$(head /dev/urandom 2>/dev/null | tr -dc 'a-z0-9' | head -c 16 || true)
    if [ -z "$RANDOM_ID" ]; then
        RANDOM_ID="edge_$(date +%s)_$$"
    fi
    DEVICE_ID="edge_$RANDOM_ID"
    echo "   ⚠️  Could not retrieve hardware serial number. Generated random ID: $DEVICE_ID"
else
    CLEAN_ID=$(echo "$DEVICE_ID" | tr -dc 'a-zA-Z0-9_-')
    DEVICE_ID="edge_$CLEAN_ID"
    echo "   ✅ Found hardware serial number: $DEVICE_ID"
fi

echo "$DEVICE_ID" > .device-id
echo "   ✅ Saved Device ID to $INSTALL_DIR/edge/.device-id"
echo ""

# 5. Install Python dependencies (virtual environment avoids PEP 668 system pip restrictions)
echo "🐍 Setting up Python virtual environment..."
EDGE_DIR="$INSTALL_DIR/edge"
chmod +x scripts/setup-venv.sh
AGENT_PYTHON=$(sh scripts/setup-venv.sh "$EDGE_DIR" "$PYTHON_CMD")
PYTHON_CMD="$AGENT_PYTHON"
echo "   ✅ Python dependencies installed in $EDGE_DIR/.venv"
echo ""

if [ "$NONINTERACTIVE" = true ]; then
    echo "🚀 Starting Edge Agent (non-interactive mode)..."
    start_agent_background "$EDGE_DIR" "$PYTHON_CMD"
elif [ "$(detect_os)" = "linux" ]; then
    echo "📋 Linux system detected."
    read -r -p "Would you like to install the Edge Agent as a systemd background service? (y/n) [y]: " REGISTER_SERVICE </dev/tty
    REGISTER_SERVICE=${REGISTER_SERVICE:-y}

    case "$REGISTER_SERVICE" in
        [Yy]*)
            echo "⚙️  Running daemon registration..."
            chmod +x scripts/setup-service.sh
            if ./scripts/setup-service.sh; then
                AGENT_STARTED=true
                echo "   ✅ Edge Agent registered as systemd service and started."
            else
                echo "   ⚠️  Systemd setup failed. You can start the agent manually."
            fi
            ;;
    esac
else
    echo "ℹ️  Systemd service registration is only supported on Linux (Raspberry Pi/Jetson)."
fi

if [ "$AGENT_STARTED" = false ]; then
    read -r -p "Start the Edge Agent now in the background? (y/n) [y]: " START_NOW </dev/tty
    START_NOW=${START_NOW:-y}
    case "$START_NOW" in
        [Yy]*)
            echo "🚀 Starting Edge Agent..."
            start_agent_background "$EDGE_DIR" "$PYTHON_CMD"
            ;;
    esac
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
echo "   .venv/bin/python main.py"
echo ""
if [ -f "$EDGE_DIR/agent.pid" ]; then
    echo "To stop the background agent:"
    echo "   kill \$(cat $EDGE_DIR/agent.pid)"
    echo ""
fi
if [ "$(detect_os)" = "linux" ]; then
    echo "To manage the systemd background service (if installed):"
    echo "   sudo systemctl status aura-watch-edge.service"
    echo "   sudo systemctl restart aura-watch-edge.service"
    echo ""
fi
echo "========================================================================="
