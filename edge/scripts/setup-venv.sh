#!/bin/sh
# Create or update the edge agent Python virtual environment.
set -e

DIR="${1:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
BASE_PYTHON="${2:-python3}"
VENV_DIR="$DIR/.venv"

if ! command -v "$BASE_PYTHON" >/dev/null 2>&1; then
    echo "Error: $BASE_PYTHON not found."
    exit 1
fi

if ! "$BASE_PYTHON" -c "import venv" >/dev/null 2>&1; then
    echo "Error: Python venv module is not available."
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "${ID:-}" in
            debian|ubuntu|raspbian|raspberrypi|linuxmint|pop)
                echo "On Debian / Ubuntu / Raspberry Pi OS, run:"
                echo "  sudo apt install -y python3-venv python3-full"
                ;;
            fedora|rhel|centos|rocky|almalinux|ol)
                echo "On Fedora / RHEL / Rocky, run:"
                echo "  sudo dnf install -y python3"
                ;;
            arch|manjaro|endeavouros)
                echo "On Arch Linux, run:"
                echo "  sudo pacman -S --needed python"
                ;;
        esac
    fi
    exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment at $VENV_DIR..."
    "$BASE_PYTHON" -m venv "$VENV_DIR"
fi

echo "Installing Python dependencies into virtual environment..."
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$DIR/requirements.txt"

echo "$VENV_DIR/bin/python"
