#!/usr/bin/env python3
"""Persistent ReID embedding generator using OSNet (ONNX Runtime)."""

import json
import os
import sys

import cv2
import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    print(json.dumps({"error": "onnxruntime is not installed"}), flush=True)
    sys.exit(1)

IMAGE_HEIGHT = 256
IMAGE_WIDTH = 128
PIXEL_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
PIXEL_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
EMBEDDING_DIM = 512


def resolve_model_path() -> str:
    env_path = os.environ.get("REID_MODEL_PATH")
    if env_path:
        return env_path

    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(script_dir, "../../models/osnet_x1_0.onnx"))


def preprocess_image(image_path: str) -> np.ndarray:
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")

    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (IMAGE_WIDTH, IMAGE_HEIGHT))
    img = img.astype(np.float32) / 255.0
    img = (img - PIXEL_MEAN) / PIXEL_STD
    img = np.transpose(img, (2, 0, 1))
    return np.expand_dims(img, axis=0)


def main() -> None:
    model_path = resolve_model_path()
    if not os.path.exists(model_path):
        print(json.dumps({"error": f"ONNX model not found: {model_path}"}), flush=True)
        sys.exit(1)

    try:
        session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        input_name = session.get_inputs()[0].name
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load ONNX model: {exc}"}), flush=True)
        sys.exit(1)

    print("READY", flush=True)

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break

            image_path = line.strip()
            if not image_path:
                continue

            if not os.path.exists(image_path):
                print(json.dumps({"error": f"Image file not found: {image_path}"}), flush=True)
                continue

            tensor = preprocess_image(image_path)
            output = session.run(None, {input_name: tensor})[0]
            embedding = output[0].astype(float).tolist()

            if len(embedding) != EMBEDDING_DIM:
                print(
                    json.dumps({"error": f"Invalid embedding length: {len(embedding)}"}),
                    flush=True,
                )
                continue

            print(json.dumps(embedding), flush=True)
        except Exception as exc:
            print(json.dumps({"error": f"Inference failed: {exc}"}), flush=True)


if __name__ == "__main__":
    main()
