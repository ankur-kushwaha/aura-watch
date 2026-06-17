"""OSNet ReID embedding generator (ONNX Runtime) for edge devices."""

from __future__ import annotations

import os
import threading
from typing import Optional

import cv2
import numpy as np

IMAGE_HEIGHT = 256
IMAGE_WIDTH = 128
PIXEL_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
PIXEL_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
EMBEDDING_DIM = 512


def resolve_model_path() -> str:
    env_path = os.environ.get("REID_MODEL_PATH")
    if env_path:
        return env_path

    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "models", "osnet_x1_0.onnx"),
        os.path.normpath(os.path.join(base_dir, "..", "backend", "models", "osnet_x1_0.onnx")),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return candidates[0]


def _preprocess_bgr(img_bgr: np.ndarray) -> np.ndarray:
    img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (IMAGE_WIDTH, IMAGE_HEIGHT))
    img = img.astype(np.float32) / 255.0
    img = (img - PIXEL_MEAN) / PIXEL_STD
    img = np.transpose(img, (2, 0, 1))
    return np.expand_dims(img, axis=0)


class ReidEmbedder:
    """Thread-safe OSNet ONNX embedder loaded once per edge agent."""

    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path or resolve_model_path()
        self._session = None
        self._input_name: Optional[str] = None
        self._lock = threading.Lock()
        self._load_error: Optional[str] = None

    @property
    def is_ready(self) -> bool:
        return self._session is not None

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    def validate(self) -> Optional[str]:
        """Eager-load model; return error message when unavailable."""
        with self._lock:
            self._ensure_loaded()
            return self._load_error

    def _ensure_loaded(self) -> None:
        if self._session is not None or self._load_error is not None:
            return

        try:
            import onnxruntime as ort
        except ImportError as exc:
            self._load_error = f"onnxruntime is not installed: {exc}"
            return

        if not os.path.exists(self.model_path):
            self._load_error = f"ONNX model not found: {self.model_path}"
            return

        try:
            session = ort.InferenceSession(self.model_path, providers=["CPUExecutionProvider"])
            self._session = session
            self._input_name = session.get_inputs()[0].name
            print(f"[ReID] OSNet model loaded from {self.model_path}", flush=True)
        except Exception as exc:
            self._load_error = f"Failed to load OSNet ONNX model: {exc}"

    def generate_from_bgr(self, img_bgr: np.ndarray) -> list[float]:
        with self._lock:
            self._ensure_loaded()
            if self._session is None or self._input_name is None:
                raise RuntimeError(self._load_error or "ReID embedder is not ready")

            tensor = _preprocess_bgr(img_bgr)
            output = self._session.run(None, {self._input_name: tensor})[0]
            embedding = output[0].astype(float).tolist()

        if len(embedding) != EMBEDDING_DIM:
            raise RuntimeError(f"Invalid embedding length: {len(embedding)}")
        return embedding

    def generate_from_jpeg_bytes(self, jpeg_bytes: bytes) -> list[float]:
        arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise ValueError("Could not decode JPEG crop for ReID embedding")
        return self.generate_from_bgr(img_bgr)

    def generate_from_path(self, image_path: str) -> list[float]:
        img_bgr = cv2.imread(image_path)
        if img_bgr is None:
            raise ValueError(f"Could not read image: {image_path}")
        return self.generate_from_bgr(img_bgr)
