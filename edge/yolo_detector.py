"""YOLO11n ONNX object detection for edge clip annotation (Raspberry Pi friendly)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = BASE_DIR / "models" / "yolo11n.onnx"

PERSON_CLASS = 0
VEHICLE_CLASSES = frozenset({1, 2, 3, 5, 7})  # bicycle, car, motorcycle, bus, truck

COCO_NAMES = (
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports ball",
    "kite",
    "baseball bat",
    "baseball glove",
    "skateboard",
    "surfboard",
    "tennis racket",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy bear",
    "hair drier",
    "toothbrush",
)

BOX_COLORS = {
    PERSON_CLASS: (0, 200, 255),
    1: (255, 140, 0),
    2: (0, 255, 120),
    3: (255, 80, 80),
    5: (200, 120, 255),
    7: (120, 180, 255),
}


@dataclass
class Detection:
    class_id: int
    confidence: float
    x1: int
    y1: int
    x2: int
    y2: int


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _letterbox(
    image: np.ndarray,
    new_shape: int,
    color: tuple[int, int, int] = (114, 114, 114),
) -> tuple[np.ndarray, float, tuple[int, int]]:
    h, w = image.shape[:2]
    scale = min(new_shape / h, new_shape / w)
    new_w = int(round(w * scale))
    new_h = int(round(h * scale))
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    pad_w = new_shape - new_w
    pad_h = new_shape - new_h
    left = pad_w // 2
    top = pad_h // 2
    padded = cv2.copyMakeBorder(
        resized,
        top,
        pad_h - top,
        left,
        pad_w - left,
        cv2.BORDER_CONSTANT,
        value=color,
    )
    return padded, scale, (left, top)


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.45) -> list[int]:
    if len(boxes) == 0:
        return []
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][iou <= iou_threshold]
    return keep


class YoloDetector:
    """Run YOLO11n via ONNX Runtime and draw boxes on BGR frames."""

    def __init__(
        self,
        *,
        model_path: Optional[str] = None,
        imgsz: Optional[int] = None,
        confidence: Optional[float] = None,
        detect_interval: Optional[int] = None,
        detect_person: bool = True,
        detect_vehicle: bool = True,
    ):
        self.model_path = Path(model_path or os.getenv("YOLO_MODEL_PATH", str(DEFAULT_MODEL_PATH)))
        self.imgsz = imgsz if imgsz is not None else _env_int("YOLO_IMGSZ", 320)
        self.confidence = confidence if confidence is not None else _env_float("YOLO_CONFIDENCE", 0.35)
        self.detect_interval = max(
            1,
            detect_interval if detect_interval is not None else _env_int("YOLO_DETECT_INTERVAL", 3),
        )
        self.detect_person = detect_person
        self.detect_vehicle = detect_vehicle

        self._session = None
        self._input_name: Optional[str] = None
        self._frame_idx = 0
        self._last_detections: list[Detection] = []
        self._load_error: Optional[str] = None

    @property
    def available(self) -> bool:
        return self._ensure_loaded()

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    def set_class_filters(self, *, detect_person: bool, detect_vehicle: bool) -> None:
        self.detect_person = detect_person
        self.detect_vehicle = detect_vehicle

    def _ensure_loaded(self) -> bool:
        if self._session is not None:
            return True
        if self._load_error:
            return False
        if not self.model_path.is_file():
            self._load_error = f"YOLO model not found at {self.model_path}"
            print(f"[YOLO] {self._load_error}", flush=True)
            return False
        try:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 1
            opts.inter_op_num_threads = 1
            self._session = ort.InferenceSession(
                str(self.model_path),
                opts,
                providers=["CPUExecutionProvider"],
            )
            self._input_name = self._session.get_inputs()[0].name
            print(f"[YOLO] Loaded {self.model_path.name} (imgsz={self.imgsz})", flush=True)
            return True
        except Exception as exc:
            self._load_error = str(exc)
            print(f"[YOLO] Failed to load model: {exc}", flush=True)
            return False

    def _allowed_classes(self) -> set[int]:
        allowed: set[int] = set()
        if self.detect_person:
            allowed.add(PERSON_CLASS)
        if self.detect_vehicle:
            allowed.update(VEHICLE_CLASSES)
        return allowed

    def _class_allowed(self, class_id: int) -> bool:
        allowed = self._allowed_classes()
        if not allowed:
            return True
        return class_id in allowed

    def _infer(self, frame: np.ndarray) -> list[Detection]:
        if not self._ensure_loaded() or self._session is None or self._input_name is None:
            return []

        h, w = frame.shape[:2]
        letterboxed, scale, (pad_x, pad_y) = _letterbox(frame, self.imgsz)
        blob = letterboxed[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
        blob = np.expand_dims(blob, axis=0)

        outputs = self._session.run(None, {self._input_name: blob})
        preds = outputs[0]
        if preds.ndim == 3:
            preds = preds[0]
        if preds.shape[0] < preds.shape[1]:
            preds = preds.T

        boxes_xywh = preds[:, :4]
        class_scores = preds[:, 4:]
        class_ids = np.argmax(class_scores, axis=1)
        confidences = class_scores[np.arange(len(class_ids)), class_ids]

        mask = confidences >= self.confidence
        boxes_xywh = boxes_xywh[mask]
        class_ids = class_ids[mask]
        confidences = confidences[mask]

        if len(boxes_xywh) == 0:
            return []

        cx = boxes_xywh[:, 0]
        cy = boxes_xywh[:, 1]
        bw = boxes_xywh[:, 2]
        bh = boxes_xywh[:, 3]
        x1 = cx - bw / 2
        y1 = cy - bh / 2
        x2 = cx + bw / 2
        y2 = cy + bh / 2

        x1 = (x1 - pad_x) / scale
        y1 = (y1 - pad_y) / scale
        x2 = (x2 - pad_x) / scale
        y2 = (y2 - pad_y) / scale

        boxes = np.stack([x1, y1, x2, y2], axis=1)
        boxes[:, 0] = np.clip(boxes[:, 0], 0, w - 1)
        boxes[:, 1] = np.clip(boxes[:, 1], 0, h - 1)
        boxes[:, 2] = np.clip(boxes[:, 2], 0, w - 1)
        boxes[:, 3] = np.clip(boxes[:, 3], 0, h - 1)

        detections: list[Detection] = []
        by_class: dict[int, list[int]] = {}
        for idx, (class_id, conf) in enumerate(zip(class_ids, confidences)):
            cid = int(class_id)
            if not self._class_allowed(cid):
                continue
            by_class.setdefault(cid, []).append(idx)

        for class_id, indices in by_class.items():
            idx_arr = np.array(indices, dtype=int)
            kept = _nms(boxes[idx_arr], confidences[idx_arr])
            for local_idx in kept:
                global_idx = indices[local_idx]
                detections.append(
                    Detection(
                        class_id=class_id,
                        confidence=float(confidences[global_idx]),
                        x1=int(boxes[global_idx, 0]),
                        y1=int(boxes[global_idx, 1]),
                        x2=int(boxes[global_idx, 2]),
                        y2=int(boxes[global_idx, 3]),
                    )
                )
        return detections

    def detect(self, frame: np.ndarray) -> list[Detection]:
        self._frame_idx += 1
        if self._frame_idx == 1 or self._frame_idx % self.detect_interval == 0:
            self._last_detections = self._infer(frame)
        return self._last_detections

    def draw(self, frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
        annotated = frame.copy()
        for det in detections:
            color = BOX_COLORS.get(det.class_id, (180, 180, 180))
            label = COCO_NAMES[det.class_id] if det.class_id < len(COCO_NAMES) else str(det.class_id)
            text = f"{label} {det.confidence:.2f}"
            cv2.rectangle(annotated, (det.x1, det.y1), (det.x2, det.y2), color, 2)
            (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            ty = max(det.y1 - 4, th + 4)
            cv2.rectangle(
                annotated,
                (det.x1, ty - th - baseline - 2),
                (det.x1 + tw + 4, ty + 2),
                color,
                -1,
            )
            cv2.putText(
                annotated,
                text,
                (det.x1 + 2, ty - 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (20, 20, 20),
                1,
                cv2.LINE_AA,
            )
        return annotated

    def annotate(self, frame: np.ndarray) -> np.ndarray:
        detections = self.detect(frame)
        if not detections:
            return frame
        return self.draw(frame, detections)
