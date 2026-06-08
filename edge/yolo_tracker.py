"""YOLOv8 nano object detection with ByteTrack multi-object tracking."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import numpy as np
from ultralytics import YOLO

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


@dataclass
class Detection:
    track_id: Optional[int]
    class_id: int
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2


class YoloByteTracker:
    def __init__(
        self,
        model_path: Optional[str] = None,
        confidence: float = 0.25,
        device: str = "cpu",
        class_names: Optional[list[str]] = None,
    ):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.model_path = model_path or os.path.join(base_dir, "yolov8n.pt")
        self.confidence = confidence
        self.device = device
        self.class_ids = resolve_class_ids(class_names)
        self.class_names = class_names or list(DEFAULT_DETECT_CLASSES)
        self.model = YOLO(self.model_path)
        self._objects_active = False

    def process(self, frame: np.ndarray) -> tuple[np.ndarray, list[Detection], bool]:
        """Run detection + tracking, return annotated frame, detections, and new-detection flag."""
        results = self.model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            conf=self.confidence,
            device=self.device,
            classes=self.class_ids,
            verbose=False,
        )

        result = results[0]
        detections = self._parse_detections(result)
        annotated = result.plot()

        objects_present = len(detections) > 0
        new_detection = objects_present and not self._objects_active
        if objects_present:
            self._objects_active = True
        else:
            self._objects_active = False

        return annotated, detections, new_detection

    def reset(self):
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
