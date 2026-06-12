"""Runtime configuration merged from cloud DB overrides and local env defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Optional

from device_defaults import device_config_defaults, stream_config_defaults
from yolo_tracker import resolve_yolo_device

_DEVICE_DEFAULTS = device_config_defaults()
_STREAM_DEFAULTS = stream_config_defaults()


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw != "false"


def _pick(data: dict[str, Any], key: str, env_default: Any, cast=None):
    if key in data and data[key] is not None:
        value = data[key]
        if cast is not None:
            try:
                return cast(value)
            except (TypeError, ValueError):
                return env_default
        return value
    return env_default


def rtsp_transport_value() -> str:
    return os.getenv("RTSP_TRANSPORT", "tcp").lower()


def rtsp_local_addr_value() -> str:
    return os.getenv("RTSP_LOCAL_ADDR", "").strip()


@dataclass
class DeviceRuntimeConfig:
    yolo_confidence: float = field(
        default_factory=lambda: _env_float("YOLO_CONFIDENCE", float(_DEVICE_DEFAULTS["yoloConfidence"]))
    )
    yolo_device: str = field(
        default_factory=lambda: resolve_yolo_device(
            os.getenv("YOLO_DEVICE", str(_DEVICE_DEFAULTS["yoloDevice"]))
        )
    )
    yolo_imgsz: int = field(
        default_factory=lambda: _env_int("YOLO_IMGSZ", int(_DEVICE_DEFAULTS["yoloImgsz"]))
    )
    yolo_detect_interval: int = field(
        default_factory=lambda: max(
            _env_int("YOLO_DETECT_INTERVAL", int(_DEVICE_DEFAULTS["yoloDetectInterval"])), 1
        )
    )
    camera_width: int = field(
        default_factory=lambda: _env_int("CAMERA_WIDTH", int(_DEVICE_DEFAULTS["cameraWidth"]))
    )
    camera_height: int = field(
        default_factory=lambda: _env_int("CAMERA_HEIGHT", int(_DEVICE_DEFAULTS["cameraHeight"]))
    )
    camera_fps: int = field(
        default_factory=lambda: max(_env_int("CAMERA_FPS", int(_DEVICE_DEFAULTS["cameraFps"])), 1)
    )
    clip_encode_fps: int = field(
        default_factory=lambda: max(
            _env_int(
                "CLIP_ENCODE_FPS",
                _env_int("ENCODE_FPS", int(_DEVICE_DEFAULTS["clipEncodeFps"])),
            ),
            1,
        )
    )
    camera_stall_timeout_sec: float = field(
        default_factory=lambda: _env_float(
            "CAMERA_STALL_TIMEOUT_SEC", float(_DEVICE_DEFAULTS["cameraStallTimeoutSec"])
        )
    )
    frame_stream_fps: float = field(
        default_factory=lambda: _env_float("FRAME_STREAM_FPS", float(_DEVICE_DEFAULTS["frameStreamFps"]))
    )
    preview_jpeg_quality: int = field(
        default_factory=lambda: _env_int("PREVIEW_JPEG_QUALITY", int(_DEVICE_DEFAULTS["previewJpegQuality"]))
    )
    preview_stall_timeout_sec: float = field(
        default_factory=lambda: _env_float(
            "PREVIEW_STALL_TIMEOUT_SEC", float(_DEVICE_DEFAULTS["previewStallTimeoutSec"])
        )
    )
    recording_max_sec: float = field(
        default_factory=lambda: _env_float("RECORDING_MAX_SEC", float(_DEVICE_DEFAULTS["recordingMaxSec"]))
    )
    recording_end_grace_sec: float = field(
        default_factory=lambda: _env_float(
            "RECORDING_END_GRACE_SEC", float(_DEVICE_DEFAULTS["recordingEndGraceSec"])
        )
    )
    recording_cooldown_sec: float = field(
        default_factory=lambda: _env_float(
            "RECORDING_COOLDOWN_SEC", float(_DEVICE_DEFAULTS["recordingCooldownSec"])
        )
    )
    min_upload_duration_sec: float = field(
        default_factory=lambda: _env_float(
            "MIN_UPLOAD_DURATION_SEC", float(_DEVICE_DEFAULTS["minUploadDurationSec"])
        )
    )
    reid_confidence_threshold: float = field(
        default_factory=lambda: _env_float(
            "REID_CONFIDENCE_THRESHOLD", float(_DEVICE_DEFAULTS["reidConfidenceThreshold"])
        )
    )
    reid_min_bbox_size: int = field(
        default_factory=lambda: _env_int("REID_MIN_BBOX_SIZE", int(_DEVICE_DEFAULTS["reidMinBboxSize"]))
    )
    reid_visible_sec: float = field(
        default_factory=lambda: _env_float("REID_VISIBLE_SEC", float(_DEVICE_DEFAULTS["reidVisibleSec"]))
    )
    debug_logs: bool = field(
        default_factory=lambda: _env_bool("DEBUG_LOGS", bool(_DEVICE_DEFAULTS["debugLogs"]))
    )

    @classmethod
    def from_db(cls, data: Optional[dict[str, Any]]) -> DeviceRuntimeConfig:
        if not data:
            return cls()
        baseline = cls()
        return cls(
            yolo_confidence=_pick(data, "yoloConfidence", baseline.yolo_confidence, float),
            yolo_device=resolve_yolo_device(str(data["yoloDevice"])) if data.get("yoloDevice") else baseline.yolo_device,
            yolo_imgsz=_pick(data, "yoloImgsz", baseline.yolo_imgsz, int),
            yolo_detect_interval=max(_pick(data, "yoloDetectInterval", baseline.yolo_detect_interval, int), 1),
            camera_width=_pick(data, "cameraWidth", baseline.camera_width, int),
            camera_height=_pick(data, "cameraHeight", baseline.camera_height, int),
            camera_fps=max(_pick(data, "cameraFps", baseline.camera_fps, int), 1),
            clip_encode_fps=max(_pick(data, "clipEncodeFps", baseline.clip_encode_fps, int), 1),
            camera_stall_timeout_sec=_pick(data, "cameraStallTimeoutSec", baseline.camera_stall_timeout_sec, float),
            frame_stream_fps=_pick(data, "frameStreamFps", baseline.frame_stream_fps, float),
            preview_jpeg_quality=_pick(data, "previewJpegQuality", baseline.preview_jpeg_quality, int),
            preview_stall_timeout_sec=_pick(
                data, "previewStallTimeoutSec", baseline.preview_stall_timeout_sec, float
            ),
            recording_max_sec=_pick(data, "recordingMaxSec", baseline.recording_max_sec, float),
            recording_end_grace_sec=_pick(data, "recordingEndGraceSec", baseline.recording_end_grace_sec, float),
            recording_cooldown_sec=_pick(data, "recordingCooldownSec", baseline.recording_cooldown_sec, float),
            min_upload_duration_sec=_pick(data, "minUploadDurationSec", baseline.min_upload_duration_sec, float),
            reid_confidence_threshold=_pick(
                data, "reidConfidenceThreshold", baseline.reid_confidence_threshold, float
            ),
            reid_min_bbox_size=_pick(data, "reidMinBboxSize", baseline.reid_min_bbox_size, int),
            reid_visible_sec=_pick(data, "reidVisibleSec", baseline.reid_visible_sec, float),
            debug_logs=_pick(data, "debugLogs", baseline.debug_logs, bool) if "debugLogs" in data else baseline.debug_logs,
        )

    def affects_pipeline(self, other: DeviceRuntimeConfig) -> bool:
        return self != other


def default_stream_tracking_enabled() -> bool:
    return bool(_STREAM_DEFAULTS["trackingEnabled"])
