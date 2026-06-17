#!/usr/bin/env python3
"""Debug clip YOLO + ReID processing for a local MP4."""

from __future__ import annotations

import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.chdir(BASE)

from dotenv import load_dotenv

load_dotenv(os.path.join(BASE, ".env"))

from clip_processor import process_clip
from reid_embedder import ReidEmbedder
from yolo_tracker import YoloByteTracker, parse_class_names


def main() -> None:
    clip = sys.argv[1] if len(sys.argv) > 1 else (
        "storage/temp_clips/clip_1781700309663_edge_DL4CM4DV9_2_stream_1781698136996.mp4"
    )
    classes = parse_class_names(os.getenv("YOLO_CLASSES", "person,vehicle"))
    tracker = YoloByteTracker(
        confidence=float(os.getenv("YOLO_CONFIDENCE", "0.35")),
        class_names=classes,
    )
    embedder = ReidEmbedder()
    print(f"embedder ready={embedder.is_ready} error={embedder.load_error!r}")

    result = process_clip(
        clip,
        tracker,
        embedder,
        detect_interval=int(os.getenv("YOLO_DETECT_INTERVAL", "2")),
    )
    reid = [e for e in result.track_events if e.get("kind") == "reid"]
    snaps = [e for e in result.track_events if e.get("kind") == "snapshot"]
    print(f"has_targets={result.has_targets}")
    print(f"snapshots={len(snaps)} reid_events={len(reid)} reid_crops={len(result.reid_crops)}")
    tracks = sorted({e["trackId"] for e in result.track_events})
    print(f"track_ids={tracks}")
    for event in reid[:5]:
        emb = event.get("embedding") or []
        print(
            f"  reid track={event['trackId']} class={event['className']} "
            f"conf={event['confidence']} offsetMs={event['offsetMs']} emb_dim={len(emb)}"
        )


if __name__ == "__main__":
    main()
