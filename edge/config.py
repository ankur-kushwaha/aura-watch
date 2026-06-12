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
    recording_end_grace_sec: float = field(default_factory=lambda: _env_float("RECORDING_END_GRACE_SEC", 2.0))
    recording_cooldown_sec: float = field(default_factory=lambda: _env_float("RECORDING_COOLDOWN_SEC", 45.0))
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
            reid_confidence_threshold=_pick(data, "reidConfidenceThreshold", cls().reid_confidence_threshold, float),
            reid_min_bbox_size=_pick(data, "reidMinBboxSize", cls().reid_min_bbox_size, int),
            reid_visible_sec=_pick(data, "reidVisibleSec", cls().reid_visible_sec, float),
            debug_logs=_pick(data, "debugLogs", cls().debug_logs, bool) if "debugLogs" in data else cls().debug_logs,
        )

    def affects_pipeline(self, other: DeviceRuntimeConfig) -> bool:
        return self != other


@dataclass
class StreamRuntimeSettings:
    camera_width: Optional[int] = None
    camera_height: Optional[int] = None
    camera_fps: Optional[int] = None
    rtsp_transport: Optional[str] = None
    rtsp_local_addr: Optional[str] = None
    clip_encode_fps: Optional[int] = None
    recording_max_sec: Optional[float] = None
    recording_end_grace_sec: Optional[float] = None
    recording_cooldown_sec: Optional[float] = None
    yolo_confidence: Optional[float] = None
    yolo_imgsz: Optional[int] = None
    yolo_detect_interval: Optional[int] = None
    frame_stream_fps: Optional[float] = None
    preview_jpeg_quality: Optional[int] = None
    preview_stall_timeout_sec: Optional[float] = None
    reid_confidence_threshold: Optional[float] = None
    reid_min_bbox_size: Optional[int] = None
    reid_visible_sec: Optional[float] = None

    @classmethod
    def from_db(cls, data: Optional[dict[str, Any]]) -> StreamRuntimeSettings:
        if not data:
            return cls()
        return cls(
            camera_width=data.get("cameraWidth"),
            camera_height=data.get("cameraHeight"),
            camera_fps=data.get("cameraFps"),
            rtsp_transport=data.get("rtspTransport"),
            rtsp_local_addr=data.get("rtspLocalAddr"),
            clip_encode_fps=data.get("clipEncodeFps"),
            recording_max_sec=data.get("recordingMaxSec"),
            recording_end_grace_sec=data.get("recordingEndGraceSec"),
            recording_cooldown_sec=data.get("recordingCooldownSec"),
            yolo_confidence=data.get("yoloConfidence"),
            yolo_imgsz=data.get("yoloImgsz"),
            yolo_detect_interval=data.get("yoloDetectInterval"),
            frame_stream_fps=data.get("frameStreamFps"),
            preview_jpeg_quality=data.get("previewJpegQuality"),
            preview_stall_timeout_sec=data.get("previewStallTimeoutSec"),
            reid_confidence_threshold=data.get("reidConfidenceThreshold"),
            reid_min_bbox_size=data.get("reidMinBboxSize"),
            reid_visible_sec=data.get("reidVisibleSec"),
        )

    def effective(self, device: DeviceRuntimeConfig) -> DeviceRuntimeConfig:
        return DeviceRuntimeConfig(
            yolo_confidence=self.yolo_confidence if self.yolo_confidence is not None else device.yolo_confidence,
            yolo_device=device.yolo_device,
            yolo_imgsz=self.yolo_imgsz if self.yolo_imgsz is not None else device.yolo_imgsz,
            yolo_detect_interval=(
                max(self.yolo_detect_interval, 1)
                if self.yolo_detect_interval is not None
                else device.yolo_detect_interval
            ),
            camera_width=self.camera_width if self.camera_width is not None else device.camera_width,
            camera_height=self.camera_height if self.camera_height is not None else device.camera_height,
            camera_fps=max(self.camera_fps, 1) if self.camera_fps is not None else device.camera_fps,
            clip_encode_fps=max(self.clip_encode_fps, 1) if self.clip_encode_fps is not None else device.clip_encode_fps,
            camera_stall_timeout_sec=device.camera_stall_timeout_sec,
            frame_stream_fps=self.frame_stream_fps if self.frame_stream_fps is not None else device.frame_stream_fps,
            preview_jpeg_quality=(
                self.preview_jpeg_quality if self.preview_jpeg_quality is not None else device.preview_jpeg_quality
            ),
            preview_stall_timeout_sec=(
                self.preview_stall_timeout_sec
                if self.preview_stall_timeout_sec is not None
                else device.preview_stall_timeout_sec
            ),
            recording_max_sec=self.recording_max_sec if self.recording_max_sec is not None else device.recording_max_sec,
            recording_end_grace_sec=(
                self.recording_end_grace_sec if self.recording_end_grace_sec is not None else device.recording_end_grace_sec
            ),
            recording_cooldown_sec=(
                self.recording_cooldown_sec if self.recording_cooldown_sec is not None else device.recording_cooldown_sec
            ),
            reid_confidence_threshold=(
                self.reid_confidence_threshold
                if self.reid_confidence_threshold is not None
                else device.reid_confidence_threshold
            ),
            reid_min_bbox_size=(
                self.reid_min_bbox_size if self.reid_min_bbox_size is not None else device.reid_min_bbox_size
            ),
            reid_visible_sec=self.reid_visible_sec if self.reid_visible_sec is not None else device.reid_visible_sec,
            debug_logs=device.debug_logs,
        )

    def rtsp_transport_value(self) -> str:
        return (self.rtsp_transport or os.getenv("RTSP_TRANSPORT", "tcp")).lower()

    def rtsp_local_addr_value(self) -> str:
        return (self.rtsp_local_addr or os.getenv("RTSP_LOCAL_ADDR", "")).strip()

    def affects_pipeline(self, other: StreamRuntimeSettings) -> bool:
        return self != other
