"""Lightweight pixel-diff motion detection on downscaled grayscale frames."""

from __future__ import annotations

import cv2
import numpy as np


class MotionDetector:
    def __init__(
        self,
        width: int = 320,
        height: int = 240,
        motion_threshold: int = 25,
        pixel_change_threshold: float = 0.02,
    ):
        self.width = width
        self.height = height
        self.motion_threshold = motion_threshold
        self.pixel_change_threshold = pixel_change_threshold
        self._prev_gray: np.ndarray | None = None

    def reset(self) -> None:
        self._prev_gray = None

    def detect(self, frame_bgr: np.ndarray) -> tuple[bool, float]:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        if gray.shape[1] != self.width or gray.shape[0] != self.height:
            gray = cv2.resize(gray, (self.width, self.height))

        if self._prev_gray is None:
            self._prev_gray = gray
            return False, 0.0

        diff = cv2.absdiff(gray, self._prev_gray)
        self._prev_gray = gray
        _, thresh = cv2.threshold(diff, self.motion_threshold, 255, cv2.THRESH_BINARY)
        changed_ratio = float(np.count_nonzero(thresh)) / float(thresh.size)
        return changed_ratio >= self.pixel_change_threshold, changed_ratio
