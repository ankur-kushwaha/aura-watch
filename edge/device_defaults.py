"""Load shared edge defaults from config/edge-device-defaults.json (repo root)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CACHE: dict[str, Any] | None = None


def _defaults_file() -> Path:
    base = Path(__file__).resolve().parent
    candidates = (
        base.parent / "config" / "edge-device-defaults.json",
        base / "edge-device-defaults.json",
    )
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError(
        "edge-device-defaults.json not found. Expected at repo config/ or edge/."
    )


def load_defaults() -> dict[str, Any]:
    global _CACHE
    if _CACHE is None:
        with _defaults_file().open(encoding="utf-8") as handle:
            _CACHE = json.load(handle)
    return _CACHE


def device_config_defaults() -> dict[str, Any]:
    return dict(load_defaults()["deviceConfig"])


def stream_config_defaults() -> dict[str, Any]:
    return dict(load_defaults()["streamDefaults"])
