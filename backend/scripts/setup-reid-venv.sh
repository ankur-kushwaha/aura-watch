#!/bin/sh
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$DIR/.venv-reid"
REQ_FILE="$DIR/requirements-reid.txt"
MODEL_FILE="$DIR/models/osnet_x1_0.onnx"

resolve_python() {
  for candidate in python3.14 python3.13 python3.12 python3.11 python3.10 \
    /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

if [ ! -f "$MODEL_FILE" ]; then
  echo "Error: Missing ONNX model at $MODEL_FILE" >&2
  echo "Export it once with PyTorch:" >&2
  echo "  pip install -r requirements-reid-export.txt" >&2
  echo "  python scripts/export-reid-onnx.py" >&2
  exit 1
fi

if ! BASE_PYTHON="$(resolve_python)"; then
  echo "Error: Python 3.10+ is required for the ReID worker." >&2
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  "$BASE_PYTHON" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE"

echo "ReID venv ready at $VENV_DIR (ONNX Runtime)"
echo "Add to backend/.env: REID_PYTHON=$VENV_DIR/bin/python"
