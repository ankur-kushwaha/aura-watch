"""Lightweight HTTP server for direct HLS segment delivery."""

from __future__ import annotations

import os
import socket
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional


def get_lan_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return "127.0.0.1"


def build_stream_host(port: int) -> str:
    host = os.getenv("EDGE_HTTP_HOST", "").strip() or get_lan_ip()
    return f"http://{host}:{port}"


class _HlsRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, format: str, *args):
        if os.getenv("DEBUG_LOGS", "true").lower() != "false":
            super().log_message(format, *args)


class HlsStreamServer:
    def __init__(self, hls_dir: str, port: int):
        self.hls_dir = hls_dir
        self.port = port
        self._httpd: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def stream_host(self) -> str:
        return build_stream_host(self.port)

    def start(self):
        if self._httpd:
            return

        handler = partial(_HlsRequestHandler, directory=self.hls_dir)
        self._httpd = ThreadingHTTPServer(("0.0.0.0", self.port), handler)
        self._thread = threading.Thread(
            target=self._httpd.serve_forever,
            name="hls-http",
            daemon=True,
        )
        self._thread.start()

    def stop(self):
        if not self._httpd:
            return
        self._httpd.shutdown()
        self._httpd.server_close()
        self._httpd = None
        self._thread = None
