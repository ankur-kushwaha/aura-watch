"""Fixed-size ring buffer of video frames for clip pre-roll."""

from __future__ import annotations

import threading
from collections import deque

import numpy as np


class FrameRingBuffer:
    def __init__(self, capacity: int):
        self.capacity = max(capacity, 1)
        self._frames: deque[np.ndarray] = deque(maxlen=self.capacity)
        self._lock = threading.Lock()

    def push(self, frame: np.ndarray) -> None:
        with self._lock:
            self._frames.append(frame.copy())

    def snapshot(self) -> list[np.ndarray]:
        with self._lock:
            return [frame.copy() for frame in self._frames]

    def clear(self) -> None:
        with self._lock:
            self._frames.clear()
