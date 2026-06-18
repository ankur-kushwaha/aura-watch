#!/usr/bin/env python3
"""Background worker to process queued edge clips (YOLO + ByteTrack + OSNet ReID + Upload)."""

from __future__ import annotations

import base64
import json
import os
import shutil
import struct
import sys
import time
from typing import Any, Callable, Optional

import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
load_dotenv(os.path.join(BASE_DIR, ".env"))

from agent_log import AgentLogger
from clip_processor import process_clip
from recorder import clip_meets_upload_threshold, upload_clip
from reid_embedder import ReidEmbedder
from yolo_tracker import YoloByteTracker

CLOUD_URL = os.getenv("CLOUD_URL", "https://aura-watch.adboardtools.com").rstrip("/")
LOCAL_VIDEO_DIR = os.getenv("LOCAL_VIDEO_DIR", os.path.join(BASE_DIR, "storage", "temp_clips"))
LOCAL_CROPS_DIR = os.getenv("LOCAL_CROPS_DIR", os.path.join(BASE_DIR, "storage", "crops"))
LOCAL_CLIPS_DIR = os.path.join(BASE_DIR, "storage", "clips")
LOCAL_FAILED_DIR = os.path.join(BASE_DIR, "storage", "failed")
DEVICE_ID_FILE = os.path.join(BASE_DIR, ".device-id")
WORKER_LOG_FILE = os.getenv("WORKER_LOG_FILE", os.path.join(BASE_DIR, "storage", "worker.log"))

_worker_logger = AgentLogger(WORKER_LOG_FILE)


def wlog(message: str) -> None:
    """Write to worker.log and flush to stdout (captured by agent pipe)."""
    _worker_logger.write(message, tag="Worker")



def load_device_id() -> str:
    if os.path.exists(DEVICE_ID_FILE):
        with open(DEVICE_ID_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    return "unknown_device"


def upload_reid_crop(
    device_id: str,
    stream_id: str,
    crop_jpeg: bytes,
    track_id: int,
    confidence: float,
    bbox: tuple[int, int, int, int],
    class_name: str,
    embedding: list[float],
    timestamp_ms: int,
) -> None:
    url = f"{CLOUD_URL}/api/devices/{device_id}/reid/crop"
    bbox_str = ",".join(map(str, bbox))
    filename = f"crop_{timestamp_ms}_{device_id}_{track_id}.jpg"
    local_path = os.path.join(LOCAL_CROPS_DIR, filename)

    try:
        with open(local_path, "wb") as handle:
            handle.write(crop_jpeg)
    except Exception as exc:
        wlog(f"[ReID Error] Failed to save local crop {filename}: {exc}")

    if len(embedding) != 512:
        wlog(
            f"[ReID Error] Skipping crop upload for track {track_id}: "
            f"expected 512-dim embedding, got {len(embedding)}"
        )
        return

    encoded_embedding = base64.b64encode(struct.pack(f"{len(embedding)}f", *embedding)).decode("ascii")
    try:
        response = requests.post(
            url,
            files={"image": (filename, crop_jpeg, "image/jpeg")},
            data={
                "embedding": encoded_embedding,
                "trackId": str(track_id),
                "confidence": f"{confidence:.4f}",
                "bbox": bbox_str,
                "timestamp": str(timestamp_ms),
                "className": class_name,
                "streamId": stream_id,
            },
            timeout=30,
        )
        if response.status_code >= 200 and response.status_code < 300:
            wlog(f"Successfully uploaded ReID crop for track {track_id} on stream {stream_id}")
        else:
            wlog(f"[ReID Error] Upload failed ({response.status_code}): {response.text}")
    except Exception as exc:
        wlog(f"[ReID Error] Upload exception: {exc}")


def process_single_job(json_path: str, embedder: ReidEmbedder, device_id: str) -> None:
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            job = json.load(f)
    except Exception as exc:
        wlog(f"[Worker Error] Failed to read sidecar {os.path.basename(json_path)}: {exc}")
        try:
            os.unlink(json_path)
        except OSError:
            pass
        return

    # Increment attempts and save back
    job["attempts"] = job.get("attempts", 0) + 1
    filename = job["filename"]
    stream_id = job["stream_id"]
    mp4_path = os.path.join(LOCAL_VIDEO_DIR, filename)

    # Check attempt limit (Poison Pill mitigation)
    if job["attempts"] > 3:
        wlog(f"[Worker Warning] Clip {filename} exceeded attempt limit (attempts={job['attempts']}). Discarding.")
        try:
            os.unlink(json_path)
        except OSError:
            pass
        if os.path.exists(mp4_path):
            os.makedirs(LOCAL_FAILED_DIR, exist_ok=True)
            try:
                shutil.move(mp4_path, os.path.join(LOCAL_FAILED_DIR, filename))
                wlog(f"[Worker] Moved poisoned clip {filename} to {LOCAL_FAILED_DIR}")
            except Exception as e:
                wlog(f"[Worker Error] Failed to move poisoned clip: {e}")
                try:
                    os.unlink(mp4_path)
                except OSError:
                    pass
        return

    # Save attempts back to sidecar
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(job, f, indent=2)
    except Exception as exc:
        wlog(f"[Worker Warning] Failed to update attempts in sidecar: {exc}")

    if not os.path.exists(mp4_path):
        wlog(f"[Worker Warning] Video file {filename} not found for sidecar. Discarding sidecar.")
        try:
            os.unlink(json_path)
        except OSError:
            pass
        return

    wlog(f"[{stream_id}] Running YOLO + ByteTrack on clip {filename} (attempt {job['attempts']})...")
    try:
        tracker = YoloByteTracker(
            confidence=float(job.get("yolo_confidence", 0.35)),
            device=job.get("yolo_device", "cpu"),
            class_names=job.get("detection_classes", ["person", "vehicle"]),
            imgsz=int(job.get("yolo_imgsz", 320)),
            reid_confidence_threshold=float(job.get("reid_confidence_threshold", 0.70)),
            reid_min_bbox_size=int(job.get("reid_min_bbox_size", 50)),
            reid_visible_sec=float(job.get("reid_visible_sec", 4.0)),
        )

        clip_result = process_clip(
            mp4_path,
            tracker,
            embedder,
            detect_interval=int(job.get("yolo_detect_interval", 1)),
        )
    except Exception as exc:
        wlog(f"[{stream_id}] Clip analysis failed for {filename}: {exc}")
        # We don't delete on error yet, let retry mechanism handle it or delete if exceeded
        return

    if not clip_result.has_targets:
        wlog(f"[{stream_id}] No person/vehicle in {filename} — discarding locally.")
        try:
            os.unlink(mp4_path)
        except OSError:
            pass
        try:
            os.unlink(json_path)
        except OSError:
            pass
        return

    if not clip_result.reid_crops:
        wlog(
            f"[{stream_id}] WARNING: YOLO found objects but no ReID profiles were created. "
            f"Check OSNet model ({embedder.model_path}) and edge logs."
        )

    track_events = clip_result.track_events
    preroll_ms = (
        int(job.get("preroll_frame_count", 0) / job.get("clip_fps", 10) * 1000)
        if job.get("preroll_frame_count")
        else 0
    )
    clip_start_ms = job["timestamp_ms"] - preroll_ms

    # Upload ReID crops
    reid_uploaded = 0
    for crop in clip_result.reid_crops:
        detection_ms = clip_start_ms + crop.offset_ms
        try:
            upload_reid_crop(
                device_id=device_id,
                stream_id=stream_id,
                crop_jpeg=crop.crop_jpeg,
                track_id=crop.track_id,
                confidence=crop.confidence,
                bbox=crop.bbox,
                class_name=crop.class_name,
                embedding=crop.embedding,
                timestamp_ms=detection_ms,
            )
            reid_uploaded += 1
        except Exception as exc:
            wlog(f"[ReID Error] Failed to upload crop for track {crop.track_id}: {exc}")

    reid_event_count = sum(1 for event in track_events if event.get("kind") == "reid")
    wlog(
        f"[{stream_id}] Clip analysis: {reid_event_count} ReID profile(s), "
        f"{len(track_events)} total track event(s), {reid_uploaded} crop(s) uploaded."
    )

    # Move clip to persistent LOCAL_CLIPS_DIR before uploading
    os.makedirs(LOCAL_CLIPS_DIR, exist_ok=True)
    target_mp4_path = os.path.join(LOCAL_CLIPS_DIR, filename)
    try:
        shutil.move(mp4_path, target_mp4_path)
        wlog(f"[{stream_id}] Moved clip {filename} to persistent storage: {target_mp4_path}")
    except Exception as exc:
        wlog(f"[{stream_id}] Failed to move clip to persistent storage: {exc}. Keeping temp path.")
        target_mp4_path = mp4_path

    wlog(
        f"[{stream_id}] Uploading clip to Cloud: {filename} "
        f"({len(track_events)} track event(s))..."
    )
    try:
        upload_clip(
            CLOUD_URL,
            device_id,
            target_mp4_path,
            filename,
            duration=job.get("actual_duration"),
            stream_id=stream_id,
            track_events=track_events,
            frame_width=job.get("width"),
            frame_height=job.get("height"),
            clip_start_ms=clip_start_ms,
        )
        wlog(f"[{stream_id}] Successfully uploaded clip to Cloud: {filename}")

        # Successfully uploaded and saved locally, now we can remove sidecar
        try:
            os.unlink(json_path)
        except OSError:
            pass
    except Exception as exc:
        wlog(f"[{stream_id}] Clip upload failed for {filename}: {exc}")
        # Move back to temp so it can be retried if it was moved
        if target_mp4_path != mp4_path and os.path.exists(target_mp4_path):
            try:
                shutil.move(target_mp4_path, mp4_path)
            except Exception:
                pass


def main() -> None:
    wlog("[Worker] Starting edge clip processing worker process...")
    os.makedirs(LOCAL_VIDEO_DIR, exist_ok=True)
    os.makedirs(LOCAL_CROPS_DIR, exist_ok=True)
    os.makedirs(LOCAL_CLIPS_DIR, exist_ok=True)

    device_id = load_device_id()
    wlog(f"[Worker] Device ID: {device_id}")

    embedder = ReidEmbedder()
    reid_error = embedder.validate()
    if reid_error:
        wlog(f"[Worker] WARNING: ReidEmbedder failed to initialize: {reid_error}")
    else:
        wlog(f"[Worker] OSNet ready at {embedder.model_path}")

    while True:
        try:
            # Find and sort JSON files in temp_clips
            files = []
            for name in os.listdir(LOCAL_VIDEO_DIR):
                if name.endswith(".json"):
                    full_path = os.path.join(LOCAL_VIDEO_DIR, name)
                    try:
                        mtime = os.path.getmtime(full_path)
                        files.append((mtime, full_path))
                    except OSError:
                        pass

            if not files:
                time.sleep(1.5)
                continue

            # Process oldest first (FIFO)
            files.sort()
            _, oldest_json = files[0]
            process_single_job(oldest_json, embedder, device_id)
            time.sleep(0.1)

        except KeyboardInterrupt:
            wlog("[Worker] Stopping worker process on SIGINT")
            break
        except Exception as exc:
            wlog(f"[Worker Loop Error] {exc}")
            time.sleep(2.0)


if __name__ == "__main__":
    main()
