"""Scan the local LAN for RTSP cameras from the edge device."""

from __future__ import annotations

import concurrent.futures
import ipaddress
import socket
import subprocess
from typing import Any

RTSP_PORTS = (554, 8554)
SCAN_CONNECT_TIMEOUT = 0.35
RTSP_PROBE_TIMEOUT = 0.75
MAX_SCAN_WORKERS = 64


def _local_ipv4_networks() -> list[ipaddress.IPv4Network]:
    """Return IPv4 subnets attached to this host."""
    networks: list[ipaddress.IPv4Network] = []
    seen: set[str] = set()

    try:
        result = subprocess.run(
            ["ip", "-4", "route", "show", "scope", "link"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        for line in result.stdout.splitlines():
            parts = line.split()
            if not parts or "/" not in parts[0]:
                continue
            try:
                network = ipaddress.IPv4Network(parts[0], strict=False)
            except ValueError:
                continue
            key = str(network)
            if key in seen:
                continue
            seen.add(key)
            networks.append(network)
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        pass

    if not networks:
        local_ip = _guess_local_ipv4()
        if local_ip:
            octets = local_ip.split(".")
            networks.append(
                ipaddress.IPv4Network(f"{octets[0]}.{octets[1]}.{octets[2]}.0/24", strict=False)
            )

    return networks


def _guess_local_ipv4() -> str | None:
    probe_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe_socket.connect(("8.8.8.8", 80))
        return probe_socket.getsockname()[0]
    except OSError:
        return None
    finally:
        probe_socket.close()


def _local_ipv4_addresses() -> set[str]:
    addresses: set[str] = set()
    local_ip = _guess_local_ipv4()
    if local_ip:
        addresses.add(local_ip)

    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            addresses.add(info[4][0])
    except OSError:
        pass

    return addresses


def _port_open(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _rtsp_options_ok(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            request = (
                f"OPTIONS rtsp://{host}:{port}/ RTSP/1.0\r\n"
                "CSeq: 1\r\n"
                "User-Agent: AuraWatch-Scanner\r\n"
                "\r\n"
            )
            sock.sendall(request.encode("ascii", errors="ignore"))
            response = sock.recv(1024).decode("utf-8", errors="ignore")
            return response.startswith("RTSP/")
    except OSError:
        return False


def _probe_host(host: str, ports: tuple[int, ...]) -> dict[str, str] | None:
    for port in ports:
        if not _port_open(host, port, SCAN_CONNECT_TIMEOUT):
            continue
        if not _rtsp_options_ok(host, port, RTSP_PROBE_TIMEOUT):
            continue
        return {
            "name": f"IP Camera {host}",
            "url": f"rtsp://{host}:{port}/",
            "host": host,
            "port": str(port),
        }
    return None


def scan_rtsp_cameras(
    *,
    ports: tuple[int, ...] = RTSP_PORTS,
    exclude_hosts: set[str] | None = None,
) -> dict[str, Any]:
    """Scan local subnets for hosts responding to RTSP OPTIONS."""
    exclude = exclude_hosts or set()
    exclude.update(_local_ipv4_addresses())

    networks = _local_ipv4_networks()
    if not networks:
        return {
            "cameras": [],
            "subnet": None,
            "scannedHosts": 0,
            "message": "Could not detect a local IPv4 network on this device.",
        }

    hosts: list[str] = []
    for network in networks:
        for host in network.hosts():
            host_str = str(host)
            if host_str in exclude:
                continue
            hosts.append(host_str)

    hosts = sorted(set(hosts))
    cameras: list[dict[str, str]] = []

    if not hosts:
        return {
            "cameras": [],
            "subnet": str(networks[0]),
            "scannedHosts": 0,
            "message": "No hosts available to scan on the local subnet.",
        }

    worker_count = min(MAX_SCAN_WORKERS, max(8, len(hosts)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(_probe_host, host, ports): host for host in hosts}
        for future in concurrent.futures.as_completed(futures):
            try:
                result = future.result()
            except Exception:
                continue
            if result:
                cameras.append(result)

    cameras.sort(key=lambda item: tuple(int(part) for part in item["host"].split(".")))

    subnet_label = ", ".join(str(network) for network in networks)
    return {
        "cameras": cameras,
        "subnet": subnet_label,
        "scannedHosts": len(hosts),
        "message": f"Scanned {len(hosts)} host(s) on {subnet_label}.",
    }
