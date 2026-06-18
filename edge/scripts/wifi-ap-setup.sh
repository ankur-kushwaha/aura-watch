#!/bin/sh
# Aura Watch — WiFi AP Setup Script
# Runs at boot (via aura-watch-wifi-setup.service) on headless Raspberry Pi.
#
# Behaviour:
#   1. Wait up to 30 seconds for an existing WiFi connection.
#   2. If connected → exit 0 (normal boot continues).
#   3. If not connected → start a temporary AP hotspot + captive portal
#      so the user can configure WiFi from their phone/laptop.
#
# Requirements (auto-installed if missing):
#   hostapd, dnsmasq  (for AP mode)
#   NetworkManager or wpa_supplicant + dhcpcd
#
# Environment variables (optional):
#   WIFI_IFACE        WiFi interface (default: wlan0)
#   AP_CHANNEL        WiFi channel for hotspot (default: 6)
#   PORTAL_TIMEOUT    Seconds before AP times out and reboots (default: 900)
#   DEVICE_ID         Used to build the AP SSID (AuraWatch-<last4>)

set -e

WIFI_IFACE="${WIFI_IFACE:-wlan0}"
AP_CHANNEL="${AP_CHANNEL:-6}"
PORTAL_TIMEOUT="${PORTAL_TIMEOUT:-900}"
DEVICE_ID="${DEVICE_ID:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORTAL_SCRIPT="$SCRIPT_DIR/wifi_portal.py"

# ── Helpers ────────────────────────────────────────────────────────────────────

log() { echo "[WiFi-Setup] $*" >&2; }

check_cmd() { command -v "$1" >/dev/null 2>&1; }

# Build AP SSID from last 4 chars of device ID, or hostname
build_ap_ssid() {
    if [ -n "$DEVICE_ID" ]; then
        suffix=$(echo "$DEVICE_ID" | sed 's/.*\(.\{4\}\)$/\1/' | tr '[:upper:]' '[:lower:]')
    else
        suffix=$(hostname -s 2>/dev/null | sed 's/.*\(.\{4\}\)$/\1/' || echo "pi00")
    fi
    echo "AuraWatch-${suffix}"
}

# Check if WiFi is currently connected (has an IP on the wifi interface)
is_wifi_connected() {
    # Try nmcli first
    if check_cmd nmcli; then
        state=$(nmcli -t -f DEVICE,STATE device 2>/dev/null | grep "^${WIFI_IFACE}:" | cut -d: -f2)
        if [ "$state" = "connected" ]; then
            return 0
        fi
    fi
    # Fallback: check if interface has a non-169.254.x.x IP
    if check_cmd ip; then
        ip_addr=$(ip -4 addr show "$WIFI_IFACE" 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1)
        if [ -n "$ip_addr" ] && ! echo "$ip_addr" | grep -q "^169\.254\."; then
            return 0
        fi
    fi
    return 1
}

# Wait up to N seconds for WiFi to connect
wait_for_wifi() {
    wait_sec=$1
    log "Waiting up to ${wait_sec}s for WiFi on ${WIFI_IFACE}..."
    i=0
    while [ $i -lt "$wait_sec" ]; do
        if is_wifi_connected; then
            log "WiFi connected after ${i}s."
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    return 1
}

# Install missing packages
ensure_pkg() {
    for pkg in "$@"; do
        if ! dpkg -s "$pkg" >/dev/null 2>&1; then
            log "Installing missing package: $pkg"
            apt-get install -y -q "$pkg" || log "Warning: could not install $pkg"
        fi
    done
}

# ── AP Mode ────────────────────────────────────────────────────────────────────

start_ap() {
    AP_SSID=$(build_ap_ssid)
    log "Starting AP mode: SSID=${AP_SSID} on ${WIFI_IFACE}"

    # Try NetworkManager AP mode first (Bookworm default)
    if check_cmd nmcli && systemctl is-active NetworkManager >/dev/null 2>&1; then
        start_ap_nmcli "$AP_SSID"
        return $?
    fi

    # Fallback: manual hostapd + dnsmasq
    start_ap_hostapd "$AP_SSID"
}

start_ap_nmcli() {
    ap_ssid=$1
    log "Using NetworkManager for AP (nmcli)..."

    # Remove any leftover AP connection
    nmcli connection delete aura-watch-ap 2>/dev/null || true

    # Create hotspot connection
    nmcli connection add type wifi ifname "$WIFI_IFACE" con-name aura-watch-ap \
        ssid "$ap_ssid" \
        802-11-wireless.mode ap \
        802-11-wireless.band bg \
        802-11-wireless.channel "$AP_CHANNEL" \
        ipv4.method shared \
        ipv4.addresses "192.168.4.1/24" \
        connection.autoconnect no

    nmcli connection up aura-watch-ap

    log "AP active. Portal at http://192.168.4.1/"
    run_portal "$ap_ssid"
}

start_ap_hostapd() {
    ap_ssid=$1
    log "Using hostapd + dnsmasq for AP..."

    # Install deps
    ensure_pkg hostapd dnsmasq

    # Configure static IP on wifi interface
    ip addr flush dev "$WIFI_IFACE" 2>/dev/null || true
    ip addr add 192.168.4.1/24 dev "$WIFI_IFACE"
    ip link set "$WIFI_IFACE" up

    # Write hostapd config
    HOSTAPD_CONF="/tmp/aura-hostapd.conf"
    cat > "$HOSTAPD_CONF" << HAEOF
interface=${WIFI_IFACE}
ssid=${ap_ssid}
hw_mode=g
channel=${AP_CHANNEL}
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
HAEOF

    # Write dnsmasq config (DHCP + redirect all DNS to 192.168.4.1)
    DNSMASQ_CONF="/tmp/aura-dnsmasq.conf"
    cat > "$DNSMASQ_CONF" << DMEOF
interface=${WIFI_IFACE}
dhcp-range=192.168.4.10,192.168.4.50,255.255.255.0,24h
dhcp-option=3,192.168.4.1
dhcp-option=6,192.168.4.1
address=/#/192.168.4.1
no-resolv
DMEOF

    systemctl stop hostapd 2>/dev/null || true
    systemctl stop dnsmasq 2>/dev/null || true

    hostapd -B "$HOSTAPD_CONF" -P /tmp/aura-hostapd.pid
    dnsmasq -C "$DNSMASQ_CONF" --pid-file=/tmp/aura-dnsmasq.pid

    log "AP active (hostapd). Portal at http://192.168.4.1/"
    run_portal "$ap_ssid"

    # Cleanup
    kill "$(cat /tmp/aura-hostapd.pid 2>/dev/null)" 2>/dev/null || true
    kill "$(cat /tmp/aura-dnsmasq.pid 2>/dev/null)" 2>/dev/null || true
}

run_portal() {
    ap_ssid=$1

    if [ ! -f "$PORTAL_SCRIPT" ]; then
        log "ERROR: wifi_portal.py not found at $PORTAL_SCRIPT"
        log "Rebooting in 10s..."
        sleep 10
        reboot
        return
    fi

    # Find python3
    PYTHON3=""
    for candidate in python3.12 python3.11 python3.10 python3; do
        if command -v "$candidate" >/dev/null 2>&1; then
            PYTHON3="$candidate"
            break
        fi
    done

    if [ -z "$PYTHON3" ]; then
        log "ERROR: python3 not found. Cannot run captive portal."
        sleep 10
        reboot
        return
    fi

    log "Starting captive portal (timeout=${PORTAL_TIMEOUT}s)..."
    log "Connect your phone to '${ap_ssid}' and visit http://192.168.4.1"

    # Run portal (blocks until connected or timeout)
    WIFI_IFACE="$WIFI_IFACE" "$PYTHON3" "$PORTAL_SCRIPT" \
        --ap-ssid "$ap_ssid" \
        --timeout "$PORTAL_TIMEOUT" || true

    log "Portal exited. Cleaning up AP..."

    # Take down AP connection
    if check_cmd nmcli; then
        nmcli connection down aura-watch-ap 2>/dev/null || true
        nmcli connection delete aura-watch-ap 2>/dev/null || true
    fi
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
    # Only run on Linux
    if [ "$(uname -s)" != "Linux" ]; then
        log "Not Linux — skipping WiFi setup."
        exit 0
    fi

    # Check if wifi interface exists
    if ! ip link show "$WIFI_IFACE" >/dev/null 2>&1; then
        log "Interface $WIFI_IFACE not found — skipping WiFi setup."
        exit 0
    fi

    # If already connected, nothing to do
    if wait_for_wifi 30; then
        log "WiFi already connected — skipping AP mode."
        exit 0
    fi

    log "No WiFi connection detected. Starting AP provisioning mode..."
    start_ap
}

main "$@"
