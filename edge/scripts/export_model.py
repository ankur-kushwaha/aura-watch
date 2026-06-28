#!/usr/bin/env python3
"""Export YOLO11n to ONNX for edge inference. Run once on a dev machine."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export YOLO11n for edge ONNX inference")
    parser.add_argument(
        "format",
        nargs="?",
        choices=["onnx"],
        default="onnx",
        help="Export format (only onnx is supported for Pi)",
    )
    parser.add_argument("--imgsz", type=int, default=320, help="Square inference size (320 is faster on Pi)")
    args = parser.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print(
            "Install export deps first:\n"
            "  .venv/bin/pip install -r requirements-export.txt",
            file=sys.stderr,
        )
        raise SystemExit(1) from None

    edge_dir = Path(__file__).resolve().parent.parent
    models_dir = edge_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    dest = models_dir / "yolo11n.onnx"

    print(f"Exporting yolo11n.pt to ONNX (imgsz={args.imgsz})...")
    model = YOLO("yolo11n.pt")
    exported = Path(str(model.export(format=args.format, imgsz=args.imgsz, simplify=True)))
    if exported.resolve() != dest.resolve():
        shutil.move(str(exported), str(dest))
    print(f"Saved {dest}")


if __name__ == "__main__":
    main()
