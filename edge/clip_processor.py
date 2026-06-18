"""Run YOLO + ByteTrack and ReID on a finished clip (post-record)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

import cv2
import numpy as np

from crop_appearance import analyze_crop_jpeg, analyze_vehicle_crop_jpeg, analyze_vehicle_from_frame, is_vehicle_class
from reid_embedder import ReidEmbedder
from yolo_tracker import Detection, YoloByteTracker, is_reid_eligible_class

logger = logging.getLogger(__name__)


@dataclass
class ReidCropUpload:
    crop_jpeg: bytes
    track_id: int
    confidence: float
    bbox: tuple[int, int, int, int]
    class_name: str
    offset_ms: int
    embedding: list[float]


@dataclass
class ClipProcessResult:
    track_events: list[dict[str, Any]] = field(default_factory=list)
    has_targets: bool = False
    reid_crops: list[ReidCropUpload] = field(default_factory=list)


def _clip_crop(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> Optional[bytes]:
    h_f, w_f = frame.shape[:2]
    x1 = max(0, min(bbox[0], w_f - 1))
    y1 = max(0, min(bbox[1], h_f - 1))
    x2 = max(0, min(bbox[2], w_f))
    y2 = max(0, min(bbox[3], h_f))
    if x2 <= x1 or y2 <= y1:
        return None
    crop = frame[y1:y2, x1:x2]
    ok, jpeg_buf = cv2.imencode(".jpg", crop)
    if not ok:
        return None
    return jpeg_buf.tobytes()


def _detection_event(
    detection: Detection,
    offset_ms: int,
    *,
    kind: str,
    appearance: Optional[dict[str, Any]] = None,
    embedding: Optional[list[float]] = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "trackId": detection.track_id,
        "bbox": ",".join(map(str, detection.bbox)),
        "offsetMs": offset_ms,
        "confidence": round(detection.confidence, 4),
        "className": detection.class_name,
        "kind": kind,
    }
    if appearance:
        event["appearance"] = appearance
    if embedding is not None:
        event["embedding"] = embedding
    return event


def _append_reid_event(
    detection: Detection,
    frame: np.ndarray,
    offset_ms: int,
    embedder: ReidEmbedder,
    track_events: list[dict[str, Any]],
    reid_crops: list[ReidCropUpload],
) -> bool:
    if detection.track_id is None or not is_reid_eligible_class(detection.class_name):
        return False

    crop_jpeg = _clip_crop(frame, detection.bbox)
    if not crop_jpeg:
        return False

    try:
        embedding = embedder.generate_from_jpeg_bytes(crop_jpeg)
    except Exception as exc:
        logger.warning("ReID embedding failed for track %s @ %sms: %s", detection.track_id, offset_ms, exc)
        return False

    appearance = None
    if is_vehicle_class(detection.class_name):
        appearance = analyze_vehicle_crop_jpeg(crop_jpeg)
    else:
        appearance = analyze_crop_jpeg(crop_jpeg, detection.bbox)

    track_events.append(
        _detection_event(
            detection,
            offset_ms,
            kind="reid",
            appearance=appearance,
            embedding=embedding,
        )
    )
    reid_crops.append(
        ReidCropUpload(
            crop_jpeg=crop_jpeg,
            track_id=detection.track_id,
            confidence=detection.confidence,
            bbox=detection.bbox,
            class_name=detection.class_name,
            offset_ms=offset_ms,
            embedding=embedding,
        )
    )
    return True


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr = np.array(a, dtype=np.float64)
    b_arr = np.array(b, dtype=np.float64)
    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a_arr, b_arr) / (norm_a * norm_b))


def process_clip(
    clip_path: str,
    tracker: YoloByteTracker,
    embedder: ReidEmbedder,
    *,
    detect_interval: int = 1,
) -> ClipProcessResult:
    """Analyze a recorded clip and return track events + ReID crops."""
    tracker.reset()

    capture = cv2.VideoCapture(clip_path)
    if not capture.isOpened():
        raise RuntimeError(f"Could not open clip for processing: {clip_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 10.0
    if fps <= 0:
        fps = 10.0
    detect_interval = max(detect_interval, 1)

    track_events: list[dict[str, Any]] = []
    reid_crops: list[ReidCropUpload] = []
    seen_vehicle_tracks: set[int] = set()
    last_snapshot_at: dict[int, float] = {}
    reid_track_ids: set[int] = set()
    best_by_track: dict[int, tuple[Detection, int, np.ndarray]] = {}
    has_targets = False

    frame_index = 0
    while True:
        ok, frame = capture.read()
        if not ok or frame is None:
            break

        frame_index += 1
        frame_time_sec = (frame_index - 1) / fps
        offset_ms = int(frame_time_sec * 1000)
        run_inference = frame_index % detect_interval == 0

        _annotated, detections, _new_detection, stabilized = tracker.process(
            frame,
            run_inference=run_inference,
            tracking_enabled=True,
            timeline_sec=frame_time_sec,
        )

        if detections:
            has_targets = True

        for detection in detections:
            if detection.track_id is None:
                continue
            tid = detection.track_id

            existing_best = best_by_track.get(tid)
            if not existing_best or detection.confidence > existing_best[0].confidence:
                best_by_track[tid] = (detection, offset_ms, frame.copy())

            last_at = last_snapshot_at.get(tid, -1.0)
            if frame_time_sec - last_at < 0.5:
                continue
            last_snapshot_at[tid] = frame_time_sec

            appearance = None
            if is_vehicle_class(detection.class_name):
                if tid not in seen_vehicle_tracks:
                    appearance = analyze_vehicle_from_frame(frame, detection.bbox)
                    if appearance:
                        seen_vehicle_tracks.add(tid)
            track_events.append(_detection_event(detection, offset_ms, kind="snapshot", appearance=appearance))

        for detection in stabilized:
            if detection.track_id is None:
                continue
            if _append_reid_event(detection, frame, offset_ms, embedder, track_events, reid_crops):
                reid_track_ids.add(detection.track_id)

    capture.release()

    for track_id, (detection, offset_ms, frame) in best_by_track.items():
        if track_id in reid_track_ids:
            continue
        if not is_reid_eligible_class(detection.class_name):
            continue
        if _append_reid_event(detection, frame, offset_ms, embedder, track_events, reid_crops):
            reid_track_ids.add(track_id)

    # Merge track IDs based on ReID embedding similarity to reduce duplicate object rows
    threshold = 0.70
    person_crops = [c for c in reid_crops if c.class_name == "person"]
    vehicle_crops = [c for c in reid_crops if is_vehicle_class(c.class_name)]

    merge_map: dict[int, int] = {}
    lists_to_process = [person_crops, vehicle_crops]
    for crop_list in lists_to_process:
        processed_tids = set()
        for i, crop_a in enumerate(crop_list):
            tid_a = crop_a.track_id
            if tid_a in processed_tids:
                continue
            processed_tids.add(tid_a)

            for j in range(i + 1, len(crop_list)):
                crop_b = crop_list[j]
                tid_b = crop_b.track_id
                if tid_b in processed_tids:
                    continue

                if crop_a.embedding and crop_b.embedding:
                    sim = cosine_similarity(crop_a.embedding, crop_b.embedding)
                    if sim >= threshold:
                        merge_map[tid_b] = merge_map.get(tid_a, tid_a)
                        processed_tids.add(tid_b)

    if merge_map:
        logger.info("Local same-clip track merging map: %s", merge_map)
        # 1. Update trackIds in track_events
        for event in track_events:
            tid = event.get("trackId")
            if tid in merge_map:
                event["trackId"] = merge_map[tid]

        # 2. Update track_ids in reid_crops
        for crop in reid_crops:
            if crop.track_id in merge_map:
                crop.track_id = merge_map[crop.track_id]

    return ClipProcessResult(
        track_events=track_events,
        has_targets=has_targets,
        reid_crops=reid_crops,
    )
