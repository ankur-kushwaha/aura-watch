"""Cheap appearance hints from crop/frame regions — no ML."""

from __future__ import annotations

import cv2
import numpy as np

VEHICLE_CLASSES = frozenset({"bicycle", "car", "motorcycle", "bus", "truck"})


def is_vehicle_class(class_name: str) -> bool:
    return class_name in VEHICLE_CLASSES


def _rgb_to_color_name(r: int, g: int, b: int) -> str:
    pixel = np.uint8([[[b, g, r]]])
    h, s, v = cv2.cvtColor(pixel, cv2.COLOR_BGR2HSV)[0][0]
    s_f = s / 255.0
    v_f = v / 255.0
    h_f = h * 2.0

    if v_f < 0.18:
        return "black"
    if v_f > 0.88 and s_f < 0.18:
        return "white"
    if s_f < 0.16:
        return "gray"

    if h_f < 15 or h_f >= 345:
        return "red"
    if h_f < 45:
        return "orange"
    if h_f < 70:
        return "yellow"
    if h_f < 160:
        return "green"
    if h_f < 200:
        return "cyan"
    if h_f < 260:
        return "blue"
    if h_f < 300:
        return "purple"
    return "pink"


def _dominant_color_name(region_bgr: np.ndarray) -> str | None:
    if region_bgr.size == 0:
        return None

    sampled = region_bgr[::2, ::2].reshape(-1, 3)
    counts: dict[str, int] = {}
    for b, g, r in sampled:
        name = _rgb_to_color_name(int(r), int(g), int(b))
        counts[name] = counts.get(name, 0) + 1

    if not counts:
        return None

    ranked = sorted(counts.items(), key=lambda item: (item[0] in {"black", "white", "gray"}, -item[1]))
    return ranked[0][0]


def analyze_bbox_height_ratio(bbox: tuple[int, int, int, int]) -> float | None:
    x1, y1, x2, y2 = bbox
    w = max(x2 - x1, 1)
    h = max(y2 - y1, 0)
    if h <= 0:
        return None
    return round(h / w, 2)


def analyze_crop_appearance(crop_bgr: np.ndarray, bbox: tuple[int, int, int, int]) -> dict:
    h, w = crop_bgr.shape[:2]
    upper_end = max(1, h // 3)
    lower_start = min(h - 1, (h * 2) // 3)

    upper = crop_bgr[0:upper_end, :]
    lower = crop_bgr[lower_start:h, :]

    appearance: dict = {}
    height_ratio = analyze_bbox_height_ratio(bbox)
    if height_ratio is not None:
        appearance["heightRatio"] = height_ratio

    upper_color = _dominant_color_name(upper)
    lower_color = _dominant_color_name(lower)
    if upper_color:
        appearance["upperColor"] = upper_color
    if lower_color:
        appearance["lowerColor"] = lower_color

    return appearance


def analyze_crop_jpeg(crop_jpeg: bytes, bbox: tuple[int, int, int, int]) -> dict:
    arr = np.frombuffer(crop_jpeg, dtype=np.uint8)
    crop_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if crop_bgr is None:
        height_ratio = analyze_bbox_height_ratio(bbox)
        return {"heightRatio": height_ratio} if height_ratio is not None else {}
    return analyze_crop_appearance(crop_bgr, bbox)


def analyze_vehicle_region(crop_bgr: np.ndarray) -> dict:
    h, w = crop_bgr.shape[:2]
    y1 = int(h * 0.2)
    y2 = max(y1 + 1, int(h * 0.8))
    x1 = int(w * 0.2)
    x2 = max(x1 + 1, int(w * 0.8))
    center = crop_bgr[y1:y2, x1:x2]
    color = _dominant_color_name(center)
    return {"vehicleColor": color} if color else {}


def analyze_vehicle_from_frame(frame_bgr: np.ndarray, bbox: tuple[int, int, int, int]) -> dict:
    h_f, w_f = frame_bgr.shape[:2]
    x1 = max(0, min(int(bbox[0]), w_f - 1))
    y1 = max(0, min(int(bbox[1]), h_f - 1))
    x2 = max(0, min(int(bbox[2]), w_f))
    y2 = max(0, min(int(bbox[3]), h_f))
    if x2 <= x1 or y2 <= y1:
        return {}
    crop = frame_bgr[y1:y2, x1:x2]
    return analyze_vehicle_region(crop)


def analyze_vehicle_crop_jpeg(crop_jpeg: bytes) -> dict:
    arr = np.frombuffer(crop_jpeg, dtype=np.uint8)
    crop_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if crop_bgr is None:
        return {}
    return analyze_vehicle_region(crop_bgr)
