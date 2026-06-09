#!/usr/bin/env python3
"""Export YOLOv8n to a platform-optimized format for faster edge inference.

Formats:
  onnx      — Raspberry Pi / ARM CPU (recommended on Pi)
  coreml    — Apple Silicon Mac
  engine    — NVIDIA Jetson (TensorRT)
  openvino  — Intel CPU (NUC, x86 edge boxes)
"""

from __future__ import annotations

import argparse
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description="Export YOLOv8n for edge deployment")
    parser.add_argument(
        "format",
        choices=("onnx", "coreml", "engine", "openvino"),
        help="Export target format",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=int(os.getenv("YOLO_IMGSZ", "416")),
        help="Inference input size (match YOLO_IMGSZ in .env)",
    )
    args = parser.parse_args()

    model_path = os.path.join(BASE_DIR, "yolov8n.pt")
    if not os.path.isfile(model_path):
        print(f"Error: {model_path} not found. Download or copy yolov8n.pt first.")
        sys.exit(1)

    print(f"[Export] {model_path} -> {args.format} (imgsz={args.imgsz})...")
    model = YOLO(model_path)

    export_kwargs: dict = {"format": args.format, "imgsz": args.imgsz}
    if args.format in ("onnx", "coreml"):
        export_kwargs["nms"] = True

    out = model.export(**export_kwargs)

    hints = {
        "onnx": f"YOLO_MODEL_PATH={BASE_DIR}/yolov8n.onnx",
        "coreml": f"YOLO_MODEL_PATH={BASE_DIR}/yolov8n.mlpackage",
        "engine": f"YOLO_MODEL_PATH={BASE_DIR}/yolov8n.engine",
        "openvino": f"YOLO_MODEL_PATH={BASE_DIR}/yolov8n_openvino_model",
    }
    print(f"[Export] Done: {out}")
    print(f"[Export] Add to .env: {hints[args.format]}")


if __name__ == "__main__":
    main()
