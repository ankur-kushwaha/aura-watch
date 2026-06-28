#!/bin/sh
# Create or update the edge agent Python virtual environment.
set -e

DIR="${1:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
BASE_PYTHON="${2:-python3}"
VENV_DIR="$DIR/.venv"

log() {
    echo "$@" >&2
}

if ! command -v "$BASE_PYTHON" >/dev/null 2>&1; then
    log "Error: $BASE_PYTHON not found."
    exit 1
fi

if ! "$BASE_PYTHON" -c "import venv" >/dev/null 2>&1; then
    log "Error: Python venv module is not available."
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "${ID:-}" in
            debian|ubuntu|raspbian|raspberrypi|linuxmint|pop)
                log "On Debian / Ubuntu / Raspberry Pi OS, run:"
                log "  sudo apt install -y python3-venv python3-full"
                ;;
            fedora|rhel|centos|rocky|almalinux|ol)
                log "On Fedora / RHEL / Rocky, run:"
                log "  sudo dnf install -y python3"
                ;;
            arch|manjaro|endeavouros)
                log "On Arch Linux, run:"
                log "  sudo pacman -S --needed python"
                ;;
        esac
    fi
    exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
    log "Creating Python virtual environment at $VENV_DIR..."
    "$BASE_PYTHON" -m venv "$VENV_DIR"
    log "   ✅ Virtual environment created."
else
    log "Using existing virtual environment at $VENV_DIR"
fi

export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_CACHE_DIR=1

log "Upgrading pip..."
"$VENV_DIR/bin/python" -m pip install --upgrade pip

REQ="$DIR/requirements.txt"
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "armv7l" ]; then
    REQ="$DIR/requirements-pi.txt"
    log "ARM device detected — using Pi requirements (headless OpenCV)."
fi

log "Installing Python dependencies..."
"$VENV_DIR/bin/pip" install --no-cache-dir -r "$REQ"
log "   ✅ Python dependencies installed."
