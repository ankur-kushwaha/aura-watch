#!/bin/sh
# Install Tailscale and join the tailnet for remote SSH access to edge devices.
set -e

DEVICE_HOSTNAME="${1:-$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo edge)}"
AUTH_KEY="${TAILSCALE_AUTH_KEY:-}"

sanitize_hostname() {
    # Tailscale hostnames: lowercase letters, numbers, hyphens (max 63 chars)
    echo "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | cut -c1-63
}

TS_HOSTNAME="aura-$(sanitize_hostname "$DEVICE_HOSTNAME")"

echo "=== Aura Watch — Tailscale Setup ==="

if [ "$(uname -s)" != "Linux" ]; then
    echo "Tailscale auto-setup is supported on Linux edge devices (Raspberry Pi / Jetson)."
    echo "On macOS, install manually: brew install --cask tailscale"
    exit 0
fi

if ! command -v tailscale >/dev/null 2>&1; then
    echo "Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
else
    echo "Tailscale is already installed ($(tailscale version 2>/dev/null | head -n1 || echo unknown))."
fi

if ! command -v tailscale >/dev/null 2>&1; then
    echo "Error: Tailscale install failed — tailscale binary not found."
    exit 1
fi

# Enable tailscaled on boot
if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable --now tailscaled 2>/dev/null || true
fi

if tailscale ip -4 >/dev/null 2>&1; then
    echo "Tailscale is already connected."
    TS_IP=$(tailscale ip -4 2>/dev/null || true)
    if [ -n "$TS_IP" ]; then
        echo "   Tailscale IPv4: $TS_IP"
        echo "   SSH: ssh ${USER:-$(id -un)}@${TS_IP}"
    fi
    exit 0
fi

if [ -z "$AUTH_KEY" ]; then
    echo ""
    echo "No TAILSCALE_AUTH_KEY provided."
    echo "Generate a reusable auth key at https://login.tailscale.com/admin/settings/keys"
    echo "then run:"
    echo "  sudo tailscale up --hostname=$TS_HOSTNAME --ssh"
    echo ""
    exit 0
fi

echo "Joining tailnet as hostname: $TS_HOSTNAME"
sudo tailscale up \
    --auth-key="$AUTH_KEY" \
    --hostname="$TS_HOSTNAME" \
    --ssh \
    --accept-routes=false

TS_IP=$(tailscale ip -4 2>/dev/null || true)
TS_DNS=""
if command -v python3 >/dev/null 2>&1; then
    TS_DNS=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('Self',{}).get('DNSName','')).rstrip('.'))" 2>/dev/null || true)
fi

echo ""
echo "=== Tailscale connected ==="
if [ -n "$TS_IP" ]; then
    echo "   IPv4:     $TS_IP"
fi
if [ -n "$TS_DNS" ]; then
    echo "   DNS:      $TS_DNS"
    echo "   SSH:      ssh ${USER:-$(id -un)}@$TS_DNS"
elif [ -n "$TS_IP" ]; then
    echo "   SSH:      ssh ${USER:-$(id -un)}@$TS_IP"
fi
echo ""
