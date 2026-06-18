#!/usr/bin/env python3
"""
Aura Watch — WiFi Captive Portal
Minimal stdlib-only HTTP server. Runs on 192.168.4.1:80 while the Pi is
in AP (access point) mode. Lets a user pick a nearby network and enter
the password so the Pi can connect and get back online.

Usage (called by wifi-ap-setup.sh):
    sudo python3 wifi_portal.py [--ap-ssid AuraWatch-XXXX] [--timeout 900]
"""

import argparse
import html
import json
import os
import platform
import subprocess
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────

PORTAL_HOST = "0.0.0.0"
PORTAL_PORT = 80
DEFAULT_TIMEOUT_SEC = 900  # 15 minutes → reboot
INTERFACE = os.environ.get("WIFI_IFACE", "wlan0")

connected_event = threading.Event()  # set when WiFi apply succeeds


# ──────────────────────────────────────────────────────────────────────────────
# Network helpers
# ──────────────────────────────────────────────────────────────────────────────

def _run(cmd: list[str], timeout: int = 15) -> tuple[int, str, str]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return 1, "", "Command timed out"
    except FileNotFoundError:
        return 1, "", f"Command not found: {cmd[0]}"


def scan_networks() -> list[str]:
    """Return list of nearby SSIDs (deduplicated, sorted)."""
    # Prefer nmcli (NetworkManager / Bookworm)
    rc, out, _ = _run(["nmcli", "--terse", "--fields", "SSID", "device", "wifi", "list", "--rescan", "yes"], timeout=20)
    if rc == 0:
        ssids = [line.strip() for line in out.splitlines() if line.strip() and line.strip() != "--"]
        return sorted(set(ssids))

    # Fallback: iwlist scan
    rc, out, _ = _run(["sudo", "iwlist", INTERFACE, "scan"], timeout=20)
    if rc == 0:
        ssids = []
        for line in out.splitlines():
            line = line.strip()
            if line.startswith('ESSID:"'):
                ssid = line[7:].rstrip('"')
                if ssid:
                    ssids.append(ssid)
        return sorted(set(ssids))

    return []


def has_networkmanager() -> bool:
    rc, _, _ = _run(["systemctl", "is-active", "NetworkManager"])
    return rc == 0


def apply_wifi_nmcli(ssid: str, password: str) -> tuple[bool, str]:
    """Add/update a WiFi connection via nmcli and activate it."""
    conn_name = f"aura-{ssid}"
    # Delete existing connection with same name to avoid conflicts
    _run(["nmcli", "connection", "delete", conn_name])

    rc, _, err = _run([
        "nmcli", "device", "wifi", "connect", ssid,
        "password", password,
        "name", conn_name,
        "ifname", INTERFACE,
    ], timeout=30)
    if rc == 0:
        return True, f"Connected to {ssid}"
    return False, err or "nmcli connect failed"


def apply_wifi_wpasupplicant(ssid: str, password: str) -> tuple[bool, str]:
    """Write wpa_supplicant.conf and restart networking."""
    conf_path = "/etc/wpa_supplicant/wpa_supplicant.conf"

    # Generate PSK
    rc, psk_out, _ = _run(["wpa_passphrase", ssid, password])
    if rc != 0:
        # Fallback: write plaintext (less secure but functional)
        block = f'\nnetwork={{\n    ssid="{ssid}"\n    psk="{password}"\n}}\n'
    else:
        block = "\n" + "\n".join(
            line for line in psk_out.splitlines() if not line.strip().startswith("#psk=")
        )

    try:
        with open(conf_path, "r") as f:
            existing = f.read()
    except FileNotFoundError:
        existing = "country=GB\nctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\nupdate_config=1\n"

    # Remove old block for same SSID if present
    import re
    existing = re.sub(
        r'\nnetwork=\{[^}]*ssid="' + re.escape(ssid) + r'"[^}]*\}', "", existing
    )
    new_conf = existing.rstrip() + block

    try:
        with open(conf_path, "w") as f:
            f.write(new_conf)
    except PermissionError:
        return False, "Permission denied writing wpa_supplicant.conf (run as root)"

    # Restart networking
    _run(["wpa_cli", "-i", INTERFACE, "reconfigure"])
    time.sleep(3)

    # Check if connected
    rc2, out2, _ = _run(["wpa_cli", "-i", INTERFACE, "status"])
    if "wpa_state=COMPLETED" in out2:
        return True, f"Connected to {ssid}"
    return False, "wpa_supplicant: could not connect — check SSID/password"


def apply_wifi(ssid: str, password: str) -> tuple[bool, str]:
    """Try nmcli first, then wpa_supplicant."""
    if platform.system() != "Linux":
        return False, "WiFi configuration is only supported on Linux"
    if has_networkmanager():
        return apply_wifi_nmcli(ssid, password)
    return apply_wifi_wpasupplicant(ssid, password)


# ──────────────────────────────────────────────────────────────────────────────
# HTML template
# ──────────────────────────────────────────────────────────────────────────────

PORTAL_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aura Watch — WiFi Setup</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f0f14;
    color: #e2e2e8;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }}
  .card {{
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    padding: 2rem;
    width: 100%;
    max-width: 420px;
  }}
  .logo {{
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 1.5rem;
  }}
  .logo svg {{ color: #a78bfa; }}
  .logo-text {{
    font-size: 1.15rem;
    font-weight: 700;
    background: linear-gradient(135deg, #a78bfa, #60a5fa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }}
  h1 {{ font-size: 1.1rem; font-weight: 600; margin-bottom: 0.4rem; }}
  .subtitle {{ font-size: 0.82rem; color: #888; margin-bottom: 1.5rem; line-height: 1.5; }}
  .device-info {{
    background: rgba(167,139,250,0.08);
    border: 1px solid rgba(167,139,250,0.2);
    border-radius: 8px;
    padding: 0.6rem 0.9rem;
    font-size: 0.78rem;
    color: #a78bfa;
    margin-bottom: 1.5rem;
  }}
  label {{ display: block; font-size: 0.8rem; color: #aaa; margin-bottom: 0.3rem; font-weight: 500; }}
  .field {{ margin-bottom: 1rem; }}
  select, input {{
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    padding: 0.65rem 0.85rem;
    color: #e2e2e8;
    font-size: 0.9rem;
    outline: none;
    appearance: none;
    transition: border-color 0.2s;
  }}
  select:focus, input:focus {{ border-color: #a78bfa; }}
  .or {{ text-align: center; color: #555; font-size: 0.75rem; margin: 0.5rem 0; }}
  button {{
    width: 100%;
    background: linear-gradient(135deg, #7c3aed, #4f46e5);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.75rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0.5rem;
    transition: opacity 0.2s, transform 0.1s;
  }}
  button:hover {{ opacity: 0.9; }}
  button:active {{ transform: scale(0.98); }}
  button:disabled {{ opacity: 0.5; cursor: not-allowed; }}
  .msg {{ border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.83rem; margin-top: 1rem; }}
  .msg.error {{ background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #f87171; }}
  .msg.success {{ background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.3); color: #4ade80; }}
  .spinner {{ display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3);
    border-radius: 50%; border-top-color: white; animation: spin 0.7s linear infinite; margin-right: 6px; vertical-align: middle; }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  .scan-btn {{
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    color: #a78bfa;
    font-size: 0.78rem;
    padding: 0.35rem 0.7rem;
    width: auto;
    border-radius: 6px;
    font-weight: 500;
    float: right;
    margin-top: -0.2rem;
  }}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 6s4-2 11-2 11 2 11 2"/>
      <path d="M5 10s2.5-1.5 7-1.5 7 1.5 7 1.5"/>
      <path d="M9 14s1.5-0.8 3-0.8 3 0.8 3 0.8"/>
      <circle cx="12" cy="18" r="1" fill="currentColor"/>
    </svg>
    <span class="logo-text">Aura Watch</span>
  </div>

  <h1>Connect to WiFi</h1>
  <p class="subtitle">
    This device is in setup mode. Choose your network and enter the password to get it online.
  </p>

  <div class="device-info">📡 Device: <strong>{ap_ssid}</strong></div>

  <form id="wifiForm" onsubmit="return connect(event)">
    <div class="field">
      <label>
        Network (SSID)
        <button type="button" class="scan-btn" onclick="rescan()">↺ Scan</button>
      </label>
      <select id="ssidSelect" onchange="syncSsid()">
        <option value="">— scanning… —</option>
        {ssid_options}
      </select>
      <div class="or">or type manually</div>
      <input type="text" id="ssidManual" placeholder="Enter network name" autocomplete="off" spellcheck="false"/>
    </div>

    <div class="field">
      <label>Password</label>
      <input type="password" id="password" placeholder="WiFi password" autocomplete="current-password"/>
    </div>

    <button type="submit" id="submitBtn">Connect</button>
  </form>

  <div id="msg" class="msg" style="display:none"></div>
</div>

<script>
  function syncSsid() {{
    var sel = document.getElementById('ssidSelect').value;
    if (sel) document.getElementById('ssidManual').value = sel;
  }}

  function showMsg(text, type) {{
    var el = document.getElementById('msg');
    el.className = 'msg ' + type;
    el.textContent = text;
    el.style.display = 'block';
  }}

  function rescan() {{
    var sel = document.getElementById('ssidSelect');
    sel.innerHTML = '<option value="">— scanning… —</option>';
    fetch('/scan').then(r => r.json()).then(data => {{
      var opts = '<option value="">— select network —</option>';
      (data.ssids || []).forEach(function(s) {{
        opts += '<option value="' + s.replace(/"/g, '&quot;') + '">' + s + '</option>';
      }});
      sel.innerHTML = opts;
    }}).catch(function() {{
      sel.innerHTML = '<option value="">— scan failed, type manually —</option>';
    }});
  }}

  function connect(e) {{
    e.preventDefault();
    var ssid = document.getElementById('ssidManual').value.trim()
      || document.getElementById('ssidSelect').value;
    var password = document.getElementById('password').value;
    if (!ssid) {{ showMsg('Please enter or select a network name.', 'error'); return false; }}

    var btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Connecting…';
    showMsg('Applying WiFi settings — this may take up to 30 seconds…', '');

    fetch('/connect', {{
      method: 'POST',
      headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
      body: 'ssid=' + encodeURIComponent(ssid) + '&password=' + encodeURIComponent(password)
    }}).then(r => r.json()).then(data => {{
      if (data.success) {{
        showMsg('✅ ' + (data.message || 'Connected! The device will reboot and join your network.'), 'success');
        btn.textContent = 'Connected!';
      }} else {{
        showMsg('❌ ' + (data.message || 'Could not connect. Check the password and try again.'), 'error');
        btn.disabled = false;
        btn.textContent = 'Connect';
      }}
    }}).catch(function() {{
      showMsg('❌ Request failed. The device may be rebooting — that means it worked!', 'error');
      btn.textContent = 'Connect';
      btn.disabled = false;
    }});
    return false;
  }}

  // Initial scan
  rescan();
</script>
</body>
</html>
"""


# ──────────────────────────────────────────────────────────────────────────────
# HTTP handler
# ──────────────────────────────────────────────────────────────────────────────

AP_SSID = "AuraWatch-Setup"


class PortalHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logs
        print(f"[Portal] {self.address_string()} — {fmt % args}", flush=True)

    def _send(self, code: int, content_type: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # Captive portal redirect detection (iOS/Android/Windows)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _redirect_portal(self):
        self.send_response(302)
        self.send_header("Location", "http://192.168.4.1/")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        # Captive portal probes from various OSes — redirect them all to portal
        captive_paths = [
            "/generate_204", "/hotspot-detect.html", "/connecttest.txt",
            "/redirect", "/ncsi.txt", "/success.txt", "/canonical.html",
        ]
        if path in captive_paths or path.startswith("/generate_204"):
            self._redirect_portal()
            return

        if path == "/scan":
            ssids = scan_networks()
            body = json.dumps({"ssids": ssids}).encode()
            self._send(200, "application/json", body)
            return

        # Default: serve portal page
        ssid_options = ""
        for ssid in scan_networks():
            escaped = html.escape(ssid, quote=True)
            ssid_options += f'<option value="{escaped}">{html.escape(ssid)}</option>\n'

        page = PORTAL_HTML.format(ap_ssid=html.escape(AP_SSID), ssid_options=ssid_options)
        self._send(200, "text/html; charset=utf-8", page.encode())

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/connect":
            self._send(404, "text/plain", b"Not found")
            return

        length = int(self.headers.get("Content-Length", 0))
        body_raw = self.rfile.read(length).decode("utf-8", errors="replace")
        params = parse_qs(body_raw)
        ssid = params.get("ssid", [""])[0].strip()
        password = params.get("password", [""])[0]

        if not ssid:
            resp = json.dumps({"success": False, "message": "SSID is required"}).encode()
            self._send(400, "application/json", resp)
            return

        print(f"[Portal] Attempting to connect to: {ssid}", flush=True)
        success, message = apply_wifi(ssid, password)
        resp = json.dumps({"success": success, "message": message}).encode()
        self._send(200, "application/json", resp)

        if success:
            print(f"[Portal] WiFi connected to {ssid}. Scheduling reboot in 3s...", flush=True)
            connected_event.set()
            threading.Timer(3.0, lambda: _run(["sudo", "reboot"])).start()


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    global AP_SSID

    parser = argparse.ArgumentParser(description="Aura Watch WiFi captive portal")
    parser.add_argument("--ap-ssid", default="AuraWatch-Setup", help="Hotspot SSID for display")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC,
                        help="Seconds before giving up and rebooting (0 = no timeout)")
    args = parser.parse_args()

    AP_SSID = args.ap_ssid

    print(f"[Portal] Starting on port {PORTAL_PORT} (AP: {AP_SSID})", flush=True)
    print(f"[Portal] Open http://192.168.4.1/ to configure WiFi", flush=True)

    server = HTTPServer((PORTAL_HOST, PORTAL_PORT), PortalHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    timeout = args.timeout if args.timeout > 0 else float("inf")
    start = time.monotonic()

    while not connected_event.is_set():
        if time.monotonic() - start > timeout:
            print(f"[Portal] Timeout ({timeout}s) reached — rebooting.", flush=True)
            _run(["sudo", "reboot"])
            sys.exit(0)
        time.sleep(1)

    # WiFi applied, wait for reboot
    time.sleep(10)


if __name__ == "__main__":
    main()
