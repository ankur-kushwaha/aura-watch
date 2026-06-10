#!/bin/sh
# Install or refresh aura-watch-edge.service from the repo template.
# Invoked with sudo (passwordless via sudoers after setup-service.sh).
set -e

if [ "$(uname -s)" != "Linux" ]; then
    echo "Skipping systemd refresh (not Linux)."
    exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: refresh-systemd-service.sh must be run with sudo."
    exit 1
fi

DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$(logname 2>/dev/null || id -un)}"
PYTHON_PATH="$DIR/.venv/bin/python"
SERVICE_TEMPLATE="$DIR/scripts/aura-watch-edge.service.template"
SERVICE_OUT="/etc/systemd/system/aura-watch-edge.service"

if [ ! -f "$SERVICE_TEMPLATE" ]; then
    echo "Error: Template file not found: $SERVICE_TEMPLATE"
    exit 1
fi

if [ ! -x "$PYTHON_PATH" ]; then
    echo "Error: Python venv not found at $PYTHON_PATH"
    exit 1
fi

echo "Refreshing systemd unit from template..."
sed -e "s|__USER__|${USER_NAME}|g" \
    -e "s|__DIR__|${DIR}|g" \
    -e "s|__PYTHON__|${PYTHON_PATH}|g" \
    "$SERVICE_TEMPLATE" > "$SERVICE_OUT"

systemctl daemon-reload
systemctl enable aura-watch-edge.service
echo "Systemd unit refreshed and enabled."
