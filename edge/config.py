"""Runtime configuration merged from cloud DB overrides and local env defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Optional

from yolo_tracker import resolve_yolo_device


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
    yolo_confidence: float = field(default_factory=lambda: _env_float("YOLO_CONFIDENCE", 0.25))
    yolo_device: str = field(default_factory=lambda: resolve_yolo_device(os.getenv("YOLO_DEVICE", "auto")))
    yolo_imgsz: int = field(default_factory=lambda: _env_int("YOLO_IMGSZ", 416))
    yolo_detect_interval: int = field(default_factory=lambda: max(_env_int("YOLO_DETECT_INTERVAL", 3), 1))
    camera_width: int = field(default_factory=lambda: _env_int("CAMERA_WIDTH", 640))
    camera_height: int = field(default_factory=lambda: _env_int("CAMERA_HEIGHT", 480))
    camera_fps: int = field(default_factory=lambda: max(_env_int("CAMERA_FPS", 15), 1))
    clip_encode_fps: int = field(default_factory=lambda: max(_env_int("CLIP_ENCODE_FPS", _env_int("ENCODE_FPS", 10)), 1))
    camera_stall_timeout_sec: float = field(default_factory=lambda: _env_float("CAMERA_STALL_TIMEOUT_SEC", 45.0))
    frame_stream_fps: float = field(default_factory=lambda: _env_float("FRAME_STREAM_FPS", 12.0))
    preview_jpeg_quality: int = field(default_factory=lambda: _env_int("PREVIEW_JPEG_QUALITY", 70))
    preview_stall_timeout_sec: float = field(default_factory=lambda: _env_float("PREVIEW_STALL_TIMEOUT_SEC", 5.0))
    recording_max_sec: float = field(default_factory=lambda: _env_float("RECORDING_MAX_SEC", 60.0))
    recording_end_grace_sec: float = field(default_factory=lambda: _env_float("RECORDING_END_GRACE_SEC", 5.0))
    recording_cooldown_sec: float = field(default_factory=lambda: _env_float("RECORDING_COOLDOWN_SEC", 45.0))
    min_upload_duration_sec: float = field(default_factory=lambda: _env_float("MIN_UPLOAD_DURATION_SEC", 2.0))
    reid_confidence_threshold: float = field(default_factory=lambda: _env_float("REID_CONFIDENCE_THRESHOLD", 0.65))
    reid_min_bbox_size: int = field(default_factory=lambda: _env_int("REID_MIN_BBOX_SIZE", 2500))
    reid_visible_sec: float = field(default_factory=lambda: _env_float("REID_VISIBLE_SEC", 1.0))
    debug_logs: bool = field(default_factory=lambda: _env_bool("DEBUG_LOGS", True))

    @classmethod
    def from_db(cls, data: Optional[dict[str, Any]]) -> DeviceRuntimeConfig:
        if not data:
            return cls()
        return cls(
            yolo_confidence=_pick(data, "yoloConfidence", cls().yolo_confidence, float),
            yolo_device=resolve_yolo_device(str(data["yoloDevice"])) if data.get("yoloDevice") else cls().yolo_device,
            yolo_imgsz=_pick(data, "yoloImgsz", cls().yolo_imgsz, int),
            yolo_detect_interval=max(_pick(data, "yoloDetectInterval", cls().yolo_detect_interval, int), 1),
            camera_width=_pick(data, "cameraWidth", cls().camera_width, int),
            camera_height=_pick(data, "cameraHeight", cls().camera_height, int),
            camera_fps=max(_pick(data, "cameraFps", cls().camera_fps, int), 1),
            clip_encode_fps=max(_pick(data, "clipEncodeFps", cls().clip_encode_fps, int), 1),
            camera_stall_timeout_sec=_pick(data, "cameraStallTimeoutSec", cls().camera_stall_timeout_sec, float),
            frame_stream_fps=_pick(data, "frameStreamFps", cls().frame_stream_fps, float),
            preview_jpeg_quality=_pick(data, "previewJpegQuality", cls().preview_jpeg_quality, int),
            preview_stall_timeout_sec=_pick(data, "previewStallTimeoutSec", cls().preview_stall_timeout_sec, float),
            recording_max_sec=_pick(data, "recordingMaxSec", cls().recording_max_sec, float),
            recording_end_grace_sec=_pick(data, "recordingEndGraceSec", cls().recording_end_grace_sec, float),
            recording_cooldown_sec=_pick(data, "recordingCooldownSec", cls().recording_cooldown_sec, float),
            min_upload_duration_sec=_pick(data, "minUploadDurationSec", cls().min_upload_duration_sec, float),
            reid_confidence_threshold=_pick(data, "reidConfidenceThreshold", cls().reid_confidence_threshold, float),
            reid_min_bbox_size=_pick(data, "reidMinBboxSize", cls().reid_min_bbox_size, int),
            reid_visible_sec=_pick(data, "reidVisibleSec", cls().reid_visible_sec, float),
            debug_logs=_pick(data, "debugLogs", cls().debug_logs, bool) if "debugLogs" in data else cls().debug_logs,
        )

    def affects_pipeline(self, other: DeviceRuntimeConfig) -> bool:
        return self != other
