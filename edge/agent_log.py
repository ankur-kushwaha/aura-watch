"""Durable edge agent logging with immediate flush to stdout and disk."""

from __future__ import annotations

import os
import threading
from datetime import datetime, timezone


class AgentLogger:
    """Write timestamped lines to journal (stdout) and a persistent log file."""

    def __init__(self, log_path: str, max_bytes: int = 5_000_000):
        self.log_path = log_path
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        log_dir = os.path.dirname(log_path)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)

    def write(self, message: str, *, tag: str = "Edge Log") -> str:
        timestamp = datetime.now(timezone.utc).isoformat()
        local_time = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
        line = f"{local_time} [{tag}] {message}"
        with self._lock:
            print(line, flush=True)
            self._append(line)
        return timestamp

    def _append(self, line: str) -> None:
        try:
            if os.path.exists(self.log_path) and os.path.getsize(self.log_path) > self.max_bytes:
                self._rotate()
            with open(self.log_path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
                handle.flush()
                os.fsync(handle.fileno())
        except OSError:
            pass

    def _rotate(self) -> None:
        backup = f"{self.log_path}.1"
        try:
            if os.path.exists(backup):
                os.remove(backup)
            if os.path.exists(self.log_path):
                os.rename(self.log_path, backup)
        except OSError:
            pass

    def tail(self, lines: int = 200) -> str:
        try:
            with open(self.log_path, encoding="utf-8") as handle:
                content = handle.readlines()
            if not content:
                return ""
            return "".join(content[-lines:]).strip()
        except OSError:
            return ""

    def last_line(self) -> str:
        try:
            with open(self.log_path, encoding="utf-8") as handle:
                last = ""
                for line in handle:
                    stripped = line.strip()
                    if stripped:
                        last = stripped
                return last
        except OSError:
            return ""
