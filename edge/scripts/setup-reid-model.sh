#!/bin/sh
# Install OSNet ONNX weights for edge ReID (copies from repo backend or exports).
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$DIR/models"
DEST_ONNX="$DEST_DIR/osnet_x1_0.onnx"
BACKEND_ONNX="$(cd "$DIR/.." && pwd)/backend/models/osnet_x1_0.onnx"
BACKEND_DATA="$(cd "$DIR/.." && pwd)/backend/models/osnet_x1_0.onnx.data"

log() {
  echo "$@" >&2
}

if [ -f "$DEST_ONNX" ]; then
  log "ReID model already present at $DEST_ONNX"
  exit 0
fi

mkdir -p "$DEST_DIR"

if [ -f "$BACKEND_ONNX" ]; then
  log "Copying OSNet model from backend/models..."
  cp "$BACKEND_ONNX" "$DEST_ONNX"
  if [ -f "$BACKEND_DATA" ]; then
    cp "$BACKEND_DATA" "$DEST_DIR/osnet_x1_0.onnx.data"
  fi
  log "   ✅ Installed $DEST_ONNX"
  exit 0
fi

if [ -f "$DIR/../backend/scripts/export-reid-onnx.py" ]; then
  log "Exporting OSNet ONNX (one-time, requires torchreid)..."
  EXPORT_PY="$DIR/../backend/scripts/export-reid-onnx.py"
  if command -v python3 >/dev/null 2>&1; then
    python3 "$EXPORT_PY" -o "$DEST_ONNX"
    log "   ✅ Exported $DEST_ONNX"
    exit 0
  fi
fi

log "Error: OSNet model not found."
log "Run from repo root:"
log "  sh edge/scripts/setup-reid-model.sh"
log "Or set REID_MODEL_PATH in edge/.env to an existing osnet_x1_0.onnx file."
exit 1
