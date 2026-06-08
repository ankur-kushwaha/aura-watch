#!/usr/bin/env python3
"""Export YOLOv8n to CoreML for faster inference on Apple Silicon."""

from __future__ import annotations

import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from ultralytics import YOLO


def main():
    model_path = os.path.join(BASE_DIR, "yolov8n.pt")
    output_name = "yolov8n"
    imgsz = int(os.getenv("YOLO_IMGSZ", "416"))

    print(f"[CoreML] Exporting {model_path} (imgsz={imgsz})...")
    model = YOLO(model_path)
    model.export(format="coreml", imgsz=imgsz, nms=True)
    print(f"[CoreML] Done. Set YOLO_MODEL_PATH={BASE_DIR}/{output_name}.mlpackage in .env")


if __name__ == "__main__":
    main()
