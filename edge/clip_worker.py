#!/usr/bin/env python3
"""Background worker to process queued edge clips (YOLO + ByteTrack + OSNet ReID + Upload)."""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
from typing import Any, Optional

import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
load_dotenv(os.path.join(BASE_DIR, ".env"))

from agent_log import AgentLogger
from clip_processor import process_clip
from recorder import clip_meets_upload_threshold, upload_clip, update_clip_metadata
from reid_embedder import ReidEmbedder
from yolo_tracker import YoloByteTracker

CLOUD_URL = os.getenv("CLOUD_URL", "https://aura-watch.adboardtools.com").rstrip("/")
LOCAL_VIDEO_DIR = os.getenv("LOCAL_VIDEO_DIR", os.path.join(BASE_DIR, "storage", "temp_clips"))
LOCAL_CLIPS_DIR = os.path.join(BASE_DIR, "storage", "clips")
LOCAL_FAILED_DIR = os.path.join(BASE_DIR, "storage", "failed")
DEVICE_ID_FILE = os.path.join(BASE_DIR, ".device-id")
WORKER_LOG_FILE = os.getenv("WORKER_LOG_FILE", os.path.join(BASE_DIR, "storage", "worker.log"))

# Minimum free disk space (bytes) required before processing a clip.
MIN_FREE_DISK_BYTES = int(os.getenv("MIN_FREE_DISK_MB", "200")) * 1024 * 1024

# Age (seconds) after which an orphaned .mp4 in temp_clips (with no sidecar) is deleted.
ORPHAN_MAX_AGE_SEC = int(os.getenv("ORPHAN_MAX_AGE_SEC", "300"))

_worker_logger = AgentLogger(WORKER_LOG_FILE)


def wlog(message: str) -> None:
    """Write to worker.log and flush to stdout (captured by agent pipe)."""
    _worker_logger.write(message, tag="Worker")


def load_device_id() -> str:
    if os.path.exists(DEVICE_ID_FILE):
        with open(DEVICE_ID_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    return "unknown_device"


# ---------------------------------------------------------------------------
# Disk-space guard
# ---------------------------------------------------------------------------

def _has_enough_disk(path: str) -> bool:
    """Return True when free space at *path* is above MIN_FREE_DISK_BYTES."""
    try:
        return shutil.disk_usage(path).free >= MIN_FREE_DISK_BYTES
    except OSError:
        return True  # Can't check → assume OK


# ---------------------------------------------------------------------------
# Orphan cleanup
# ---------------------------------------------------------------------------

def _cleanup_orphan_temps() -> None:
    """Delete .mp4 files in temp_clips/ that have no matching .json sidecar and are old enough."""
    now = time.time()
    try:
        entries = os.listdir(LOCAL_VIDEO_DIR)
    except OSError:
        return

    sidecars = {name[:-5] for name in entries if name.endswith(".json")}  # strip ".json"
    for name in entries:
        if not name.endswith(".mp4"):
            continue
        stem = name[:-4]  # strip ".mp4"
        if stem in sidecars:
            continue  # has a matching sidecar — not an orphan
        mp4_path = os.path.join(LOCAL_VIDEO_DIR, name)
        try:
            age = now - os.path.getmtime(mp4_path)
        except OSError:
            continue
        if age >= ORPHAN_MAX_AGE_SEC:
            try:
                os.unlink(mp4_path)
                wlog(f"[Cleanup] Deleted orphan temp clip (age={age:.0f}s): {name}")
            except OSError as exc:
                wlog(f"[Cleanup Warning] Could not delete orphan {name}: {exc}")


# ---------------------------------------------------------------------------
# ReID profile builder — embedding-only, no JPEG, bundled into clip upload
# ---------------------------------------------------------------------------

def _build_reid_profiles(reid_crops: list, clip_start_ms: int) -> list[dict]:
    """Convert ReidCropUpload list → plain dicts suitable for JSON metadata.
    Only the 512-dim embedding and associated metadata are sent; the JPEG crop
    bytes are discarded so no separate /reid/crop upload is needed.
    """
    profiles = []
    for crop in reid_crops:
        if len(crop.embedding) != 512:
            wlog(
                f"[ReID Warning] Skipping track {crop.track_id}: "
                f"expected 512-dim embedding, got {len(crop.embedding)}"
            )
            continue
        profile: dict = {
            "trackId":    crop.track_id,
            "className":  crop.class_name,
            "confidence": round(crop.confidence, 4),
            "bbox":       ",".join(map(str, crop.bbox)),
            "timestamp":  clip_start_ms + crop.offset_ms,
            "embedding":  crop.embedding,   # plain list[float] — ~2 KB per identity
        }
        profiles.append(profile)
    return profiles


# ---------------------------------------------------------------------------
# Single job processor
# ---------------------------------------------------------------------------

def _build_tracker(job: dict) -> YoloByteTracker:
    """Construct a fresh YoloByteTracker from job config."""
    return YoloByteTracker(
        confidence=float(job.get("yolo_confidence", 0.35)),
        device=job.get("yolo_device", "cpu"),
        class_names=job.get("detection_classes", ["person", "vehicle"]),
        imgsz=int(job.get("yolo_imgsz", 320)),
        reid_confidence_threshold=float(job.get("reid_confidence_threshold", 0.70)),
        reid_min_bbox_size=int(job.get("reid_min_bbox_size", 50)),
        reid_visible_sec=float(job.get("reid_visible_sec", 4.0)),
    )


def _tracker_config_key(job: dict) -> tuple:
    """Return a hashable key representing the tracker config in this job.
    If the key changes between jobs we rebuild the tracker."""
    return (
        float(job.get("yolo_confidence", 0.35)),
        job.get("yolo_device", "cpu"),
        tuple(sorted(job.get("detection_classes", ["person", "vehicle"]))),
        int(job.get("yolo_imgsz", 320)),
        float(job.get("reid_confidence_threshold", 0.70)),
        int(job.get("reid_min_bbox_size", 50)),
        float(job.get("reid_visible_sec", 4.0)),
    )


def process_single_job(
    json_path: str,
    embedder: ReidEmbedder,
    device_id: str,
    tracker_state: dict,  # mutable dict: {"tracker": ..., "config_key": ...}
) -> None:
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
    mp4_path = os.path.join(LOCAL_CLIPS_DIR, filename)

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

    # Disk-space guard — skip processing if storage is critically low
    if not _has_enough_disk(LOCAL_VIDEO_DIR):
        free_mb = shutil.disk_usage(LOCAL_VIDEO_DIR).free // (1024 * 1024)
        wlog(
            f"[Worker Warning] Low disk space ({free_mb} MB free < "
            f"{MIN_FREE_DISK_BYTES // (1024*1024)} MB threshold). "
            f"Discarding clip {filename} to free space."
        )
        try:
            os.unlink(mp4_path)
            os.unlink(json_path)
        except OSError:
            pass
        return

    # Reuse tracker if config is unchanged; rebuild only when necessary
    cfg_key = _tracker_config_key(job)
    if tracker_state.get("config_key") != cfg_key or tracker_state.get("tracker") is None:
        wlog(f"[Worker] Building YoloByteTracker (config changed or first job)...")
        tracker_state["tracker"] = _build_tracker(job)
        tracker_state["config_key"] = cfg_key
    tracker: YoloByteTracker = tracker_state["tracker"]

    wlog(f"[{stream_id}] Running YOLO + ByteTrack on clip {filename} (attempt {job['attempts']})...")
    try:
        clip_result = process_clip(
            mp4_path,
            tracker,
            embedder,
            detect_interval=int(job.get("yolo_detect_interval", 1)),
        )
    except Exception as exc:
        wlog(f"[{stream_id}] Clip analysis failed for {filename}: {exc}")
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

    # Build lightweight reid profiles (embedding + metadata only, no JPEG)
    reid_profiles = _build_reid_profiles(clip_result.reid_crops, clip_start_ms)

    reid_event_count = sum(1 for event in track_events if event.get("kind") == "reid")
    wlog(
        f"[{stream_id}] Clip analysis: {reid_event_count} ReID profile(s) bundled, "
        f"{len(track_events)} total track event(s)."
    )

    # Check if the clip has already been uploaded (immediate upload succeeded in main.py)
    already_uploaded = job.get("uploaded", False)
    if not already_uploaded:
        wlog(f"[{stream_id}] Clip was not uploaded immediately. Uploading video file now...")
        try:
            upload_clip(
                CLOUD_URL,
                device_id,
                mp4_path,
                filename,
                duration=job.get("actual_duration"),
                stream_id=stream_id,
                track_events=track_events,
                frame_width=job.get("width"),
                frame_height=job.get("height"),
                clip_start_ms=clip_start_ms,
                reid_profiles=reid_profiles,
            )
            wlog(f"[{stream_id}] Successfully uploaded clip to Cloud (retry/failover): {filename}")
            # Mark as uploaded so we don't re-upload if subsequent steps fail
            job["uploaded"] = True
            try:
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(job, f, indent=2)
            except Exception:
                pass
        except Exception as exc:
            wlog(f"[{stream_id}] Clip video upload failed: {exc}")
            return
    else:
        wlog(f"[{stream_id}] Uploading clip metadata to Cloud: {filename} ({len(track_events)} track event(s))...")
        try:
            update_clip_metadata(
                CLOUD_URL,
                device_id,
                filename,
                stream_id,
                track_events,
                reid_profiles=reid_profiles,
                frame_width=job.get("width"),
                frame_height=job.get("height"),
            )
            wlog(f"[{stream_id}] Successfully updated clip metadata in Cloud: {filename}")
        except Exception as exc:
            wlog(f"[{stream_id}] Clip metadata update failed: {exc}")
            return

    # Successfully processed and uploaded/updated — remove sidecar
    try:
        os.unlink(json_path)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    wlog("[Worker] Starting edge clip processing worker process...")
    os.makedirs(LOCAL_VIDEO_DIR, exist_ok=True)
    os.makedirs(LOCAL_CLIPS_DIR, exist_ok=True)

    device_id = load_device_id()
    wlog(f"[Worker] Device ID: {device_id}")

    embedder = ReidEmbedder()
    reid_error = embedder.validate()
    if reid_error:
        wlog(f"[Worker] WARNING: ReidEmbedder failed to initialize: {reid_error}")
    else:
        wlog(f"[Worker] OSNet ready at {embedder.model_path}")

    # Mutable state for tracker reuse across jobs
    tracker_state: dict = {"tracker": None, "config_key": None}

    # Orphan cleanup counter — run every N iterations
    _orphan_check_counter = 0
    ORPHAN_CHECK_EVERY = 20  # check roughly every 30 s when idle

    while True:
        try:
            # Periodic orphan cleanup
            _orphan_check_counter += 1
            if _orphan_check_counter >= ORPHAN_CHECK_EVERY:
                _orphan_check_counter = 0
                _cleanup_orphan_temps()

            # Find and sort JSON sidecars in temp_clips
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
                time.sleep(1.5)  # Idle — sleep longer to save CPU
                continue

            # Process oldest first (FIFO)
            files.sort()
            _, oldest_json = files[0]
            process_single_job(oldest_json, embedder, device_id, tracker_state)
            time.sleep(0.1)  # Active — minimal sleep between jobs

        except KeyboardInterrupt:
            wlog("[Worker] Stopping worker process on SIGINT")
            break
        except Exception as exc:
            wlog(f"[Worker Loop Error] {exc}")
            time.sleep(2.0)


if __name__ == "__main__":
    main()
