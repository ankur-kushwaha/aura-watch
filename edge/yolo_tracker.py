"""YOLOv8 nano object detection with ByteTrack multi-object tracking."""

from __future__ import annotations

import os
import platform
from dataclasses import dataclass
from typing import Optional, Any

import cv2
import numpy as np
from ultralytics import YOLO

from device_defaults import device_config_defaults

_DEVICE_DEFAULTS = device_config_defaults()

# COCO class names used by YOLOv8n
COCO_CLASS_IDS: dict[str, int] = {
    "person": 0,
    "bicycle": 1,
    "car": 2,
    "motorcycle": 3,
    "airplane": 4,
    "bus": 5,
    "train": 6,
    "truck": 7,
    "boat": 8,
}

# person + common ground vehicles
DEFAULT_DETECT_CLASSES = ("person", "bicycle", "car", "motorcycle", "bus", "truck")


def parse_class_names(value: str) -> list[str]:
    aliases = {
        "vehicle": ("bicycle", "car", "motorcycle", "bus", "truck"),
        "vehicles": ("bicycle", "car", "motorcycle", "bus", "truck"),
    }
    names: list[str] = []
    for part in value.split(","):
        key = part.strip().lower()
        if not key:
            continue
        if key in aliases:
            names.extend(aliases[key])
        elif key in COCO_CLASS_IDS:
            names.append(key)
    return list(dict.fromkeys(names))


def resolve_class_ids(class_names: Optional[list[str]] = None) -> list[int]:
    names = class_names or list(DEFAULT_DETECT_CLASSES)
    return [COCO_CLASS_IDS[name] for name in names if name in COCO_CLASS_IDS]


def class_names_from_flags(detect_person: bool, detect_vehicle: bool) -> list[str]:
    names: list[str] = []
    if detect_person:
        names.append("person")
    if detect_vehicle:
        names.extend(["bicycle", "car", "motorcycle", "bus", "truck"])
    return names


def resolve_yolo_device(requested: str = "auto") -> str:
    import torch

    normalized = (requested or "auto").strip().lower()
    if normalized not in ("", "auto"):
        return normalized
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def resolve_model_path(model_path: Optional[str] = None) -> str:
    if model_path and os.path.exists(model_path):
        return model_path

    custom = os.getenv("YOLO_MODEL_PATH", "").strip()
    if custom and os.path.exists(custom):
        return custom

    base_dir = os.path.dirname(os.path.abspath(__file__))
    machine = platform.machine().lower()

    # Prefer platform-optimized exports when present (see scripts/export_model.py)
    candidates: list[str] = []

    if os.getenv("YOLO_USE_TENSORRT", "").lower() == "true":
        candidates.append(os.path.join(base_dir, "yolov8n.engine"))
    if os.getenv("YOLO_USE_OPENVINO", "").lower() == "true":
        candidates.append(os.path.join(base_dir, "yolov8n_openvino_model"))

    if platform.system() == "Darwin":
        candidates.append(os.path.join(base_dir, "yolov8n.mlpackage"))

    if machine in ("aarch64", "arm64", "armv7l", "armv8"):
        candidates.append(os.path.join(base_dir, "yolov8n.onnx"))

    for path in candidates:
        if os.path.exists(path):
            return path

    return os.path.join(base_dir, "yolov8n.pt")


@dataclass
class Detection:
    track_id: Optional[int]
    class_id: int
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2


def draw_detections(frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
    annotated = frame.copy()
    for detection in detections:
        x1, y1, x2, y2 = detection.bbox
        color = (255, 128, 0)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        if detection.track_id is not None:
            label = f"id:{detection.track_id} {detection.class_name} {detection.confidence:.2f}"
        else:
            label = f"{detection.class_name} {detection.confidence:.2f}"
        (text_w, text_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(annotated, (x1, y1 - text_h - 6), (x1 + text_w + 4, y1), color, -1)
        cv2.putText(
            annotated,
            label,
            (x1 + 2, y1 - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 0, 0),
            1,
            cv2.LINE_AA,
        )
    return annotated


class YoloByteTracker:
    def __init__(
        self,
        model_path: Optional[str] = None,
        confidence: float = float(_DEVICE_DEFAULTS["yoloConfidence"]),
        device: str = str(_DEVICE_DEFAULTS["yoloDevice"]),
        class_names: Optional[list[str]] = None,
        imgsz: int = int(_DEVICE_DEFAULTS["yoloImgsz"]),
        reid_confidence_threshold: Optional[float] = None,
        reid_min_bbox_size: Optional[int] = None,
        reid_visible_sec: Optional[float] = None,
    ):
        self.model_path = resolve_model_path(model_path)
        self.confidence = confidence
        self.device = resolve_yolo_device(device)
        self.imgsz = imgsz
        self.class_ids = resolve_class_ids(class_names)
        self.class_names = class_names or list(DEFAULT_DETECT_CLASSES)
        self.use_half = self.device == "cuda" and os.getenv("YOLO_HALF", "false").lower() == "true"
        self.model = YOLO(self.model_path)
        self._objects_active = False
        self._last_detections: list[Detection] = []
        
        # Track states for ReID stabilization
        self._track_states: dict[int, dict[str, Any]] = {}
        self.reid_confidence_threshold = (
            reid_confidence_threshold
            if reid_confidence_threshold is not None
            else float(os.getenv("REID_CONFIDENCE_THRESHOLD", str(_DEVICE_DEFAULTS["reidConfidenceThreshold"])))
        )
        self.reid_min_bbox_size = (
            reid_min_bbox_size
            if reid_min_bbox_size is not None
            else int(os.getenv("REID_MIN_BBOX_SIZE", str(_DEVICE_DEFAULTS["reidMinBboxSize"])))
        )
        self.reid_visible_sec = (
            reid_visible_sec if reid_visible_sec is not None else float(os.getenv("REID_VISIBLE_SEC", str(_DEVICE_DEFAULTS["reidVisibleSec"])))
        )

    def process(
        self,
        frame: np.ndarray,
        *,
        run_inference: bool = True,
        tracking_enabled: bool = True,
    ) -> tuple[np.ndarray, list[Detection], bool, list[Detection]]:
        """Run detection + tracking, return annotated frame, detections, new-detection flag, and newly stabilized ReID detections."""
        if not tracking_enabled:
            return frame, [], False, []

        if not run_inference and self._last_detections:
            detections = list(self._last_detections)
            annotated = draw_detections(frame, detections)
            new_detection = self._update_detection_state(detections)
            stabilized = self._update_track_states_and_get_stabilized(detections)
            return annotated, detections, new_detection, stabilized

        results = self.model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            conf=self.confidence,
            device=self.device,
            classes=self.class_ids,
            imgsz=self.imgsz,
            half=self.use_half,
            verbose=False,
        )

        result = results[0]
        detections = self._parse_detections(result)
        self._last_detections = detections
        annotated = draw_detections(frame, detections)
        new_detection = self._update_detection_state(detections)
        stabilized = self._update_track_states_and_get_stabilized(detections)
        return annotated, detections, new_detection, stabilized

    def _update_track_states_and_get_stabilized(self, detections: list[Detection]) -> list[Detection]:
        import time
        now = time.monotonic()

        # Prune inactive tracks (>10 seconds)
        for tid in list(self._track_states.keys()):
            if now - self._track_states[tid]["last_seen"] > 10.0:
                del self._track_states[tid]

        stabilized_targets: list[Detection] = []
        for d in detections:
            if d.track_id is None:
                continue
            if d.class_name != "person":
                continue

            tid = d.track_id
            x1, y1, x2, y2 = d.bbox
            w = x2 - x1
            h = y2 - y1
            area = w * h

            if tid not in self._track_states:
                self._track_states[tid] = {
                    "first_seen": now,
                    "last_seen": now,
                    "sent_reid": False
                }
            else:
                self._track_states[tid]["last_seen"] = now

            state = self._track_states[tid]
            visible_duration = now - state["first_seen"]

            if (
                not state["sent_reid"]
                and visible_duration >= self.reid_visible_sec
                and d.confidence >= self.reid_confidence_threshold
                and area >= self.reid_min_bbox_size
            ):
                state["sent_reid"] = True
                stabilized_targets.append(d)

        return stabilized_targets

    def _update_detection_state(self, detections: list[Detection]) -> bool:
        objects_present = len(detections) > 0
        new_detection = objects_present and not self._objects_active
        self._objects_active = objects_present
        return new_detection

    def reset(self):
        self._objects_active = False
        self._last_detections = []
        self._track_states = {}

    def reset_detection_edge(self):
        """Re-arm the new-detection edge after cooldown or clip finalization."""
        self._objects_active = False

    def _parse_detections(self, result) -> list[Detection]:
        if result.boxes is None or len(result.boxes) == 0:
            return []

        names = result.names or {}
        detections: list[Detection] = []

        for box in result.boxes:
            xyxy = box.xyxy[0].cpu().numpy().astype(int)
            cls_id = int(box.cls[0].item())
            conf = float(box.conf[0].item())
            track_id = int(box.id[0].item()) if box.id is not None else None

            detections.append(
                Detection(
                    track_id=track_id,
                    class_id=cls_id,
                    class_name=names.get(cls_id, str(cls_id)),
                    confidence=conf,
                    bbox=(int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])),
                )
            )

        return detections
