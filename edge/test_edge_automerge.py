import unittest
from unittest.mock import MagicMock, patch
import sys
import os
import numpy as np

# Add edge directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from clip_processor import cosine_similarity, _build_merge_map, process_clip, ReidCropUpload
from yolo_tracker import Detection


def _make_crop(track_id: int, embedding: list[float], confidence: float = 0.9, class_name: str = "person") -> ReidCropUpload:
    return ReidCropUpload(
        crop_jpeg=b"",
        track_id=track_id,
        confidence=confidence,
        bbox=(0, 0, 10, 10),
        class_name=class_name,
        offset_ms=0,
        embedding=embedding,
    )


class TestCosine(unittest.TestCase):
    def test_orthogonal(self):
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0], [0.0, 1.0]), 0.0)

    def test_identical(self):
        self.assertAlmostEqual(cosine_similarity([3.0, 4.0], [3.0, 4.0]), 1.0)

    def test_opposing(self):
        self.assertAlmostEqual(cosine_similarity([1.0, 1.0], [-1.0, -1.0]), -1.0)

    def test_zero_vector(self):
        self.assertAlmostEqual(cosine_similarity([0.0, 0.0], [1.0, 1.0]), 0.0)


class TestBuildMergeMap(unittest.TestCase):
    def test_no_merge_dissimilar(self):
        crops = [
            _make_crop(1, [1.0, 0.0]),
            _make_crop(2, [0.0, 1.0]),  # orthogonal → sim 0.0 < 0.70
        ]
        result = _build_merge_map(crops)
        self.assertEqual(result, {})

    def test_simple_merge(self):
        """Two identical embeddings should merge; higher id maps to lower id."""
        crops = [
            _make_crop(3, [1.0, 0.0]),
            _make_crop(5, [1.0, 0.0]),
        ]
        result = _build_merge_map(crops)
        self.assertEqual(result, {5: 3})

    def test_transitive_chain(self):
        """A~B, B~C should result in all three unified under the lowest ID."""
        emb_a = [1.0, 0.0, 0.0]
        emb_b = [0.99, 0.141, 0.0]   # cos(a,b) ≈ 0.99 ≥ 0.70
        emb_c = [0.98, 0.141, 0.141] # cos(b,c) ≈ 0.98 ≥ 0.70
        crops = [
            _make_crop(10, emb_a),
            _make_crop(20, emb_b),
            _make_crop(30, emb_c),
        ]
        result = _build_merge_map(crops)
        # All should collapse to id=10
        self.assertEqual(result.get(20), 10)
        self.assertEqual(result.get(30), 10)

    def test_single_crop_no_merge(self):
        crops = [_make_crop(7, [1.0, 0.0])]
        self.assertEqual(_build_merge_map(crops), {})

    def test_empty(self):
        self.assertEqual(_build_merge_map([]), {})

    def test_keeps_lower_id_as_canonical(self):
        crops = [
            _make_crop(100, [1.0, 0.0]),
            _make_crop(5, [1.0, 0.0]),
        ]
        result = _build_merge_map(crops)
        self.assertEqual(result, {100: 5})


class TestProcessClipMerging(unittest.TestCase):
    @patch("cv2.VideoCapture")
    def test_basic_merge_and_annotations(self, mock_vc_class):
        """Two tracks with identical embeddings should be merged; mergedFrom annotation added."""
        mock_vc = MagicMock()
        mock_vc.isOpened.return_value = True
        mock_vc.get.return_value = 10.0
        mock_frame = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_vc.read.side_effect = [
            (True, mock_frame),
            (True, mock_frame),
            (False, None),
        ]
        mock_vc_class.return_value = mock_vc

        det1 = Detection(track_id=1, class_id=0, class_name="person", confidence=0.9, bbox=(0, 0, 10, 10))
        det2 = Detection(track_id=2, class_id=0, class_name="person", confidence=0.9, bbox=(0, 0, 10, 10))

        mock_tracker = MagicMock()
        mock_tracker.reid_confidence_threshold = 0.5
        mock_tracker.process.side_effect = [
            (mock_frame, [det1], True, [det1]),
            (mock_frame, [det2], False, [det2]),
        ]

        mock_embedder = MagicMock()
        mock_embedder.generate_from_bgr.return_value = [1.0, 0.0, 0.0, 0.0]

        result = process_clip("dummy.mp4", mock_tracker, mock_embedder, detect_interval=1)

        # All track events should now carry trackId=1
        for event in result.track_events:
            self.assertEqual(event["trackId"], 1)

        # Events that originally belonged to track 2 should carry mergedFrom=2
        merged_events = [e for e in result.track_events if e.get("mergedFrom") == 2]
        self.assertTrue(len(merged_events) > 0, "Expected mergedFrom=2 annotation on at least one event")

        # After dedup: only 1 reid_crop (best confidence per merged identity)
        self.assertEqual(len(result.reid_crops), 1)
        self.assertEqual(result.reid_crops[0].track_id, 1)
        print("✔ Basic merge + mergedFrom annotation + dedup test passed!")

    @patch("cv2.VideoCapture")
    def test_no_merge_dissimilar_tracks(self, mock_vc_class):
        """Tracks with orthogonal embeddings must NOT be merged."""
        mock_vc = MagicMock()
        mock_vc.isOpened.return_value = True
        mock_vc.get.return_value = 10.0
        mock_frame = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_vc.read.side_effect = [
            (True, mock_frame),
            (True, mock_frame),
            (False, None),
        ]
        mock_vc_class.return_value = mock_vc

        det1 = Detection(track_id=1, class_id=0, class_name="person", confidence=0.9, bbox=(0, 0, 10, 10))
        det2 = Detection(track_id=2, class_id=0, class_name="person", confidence=0.7, bbox=(0, 0, 10, 10))

        mock_tracker = MagicMock()
        mock_tracker.reid_confidence_threshold = 0.5
        mock_tracker.process.side_effect = [
            (mock_frame, [det1], True, [det1]),
            (mock_frame, [det2], False, [det2]),
        ]

        mock_embedder = MagicMock()
        # Orthogonal embeddings → cosine = 0.0 < 0.70
        mock_embedder.generate_from_bgr.side_effect = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
        ]

        result = process_clip("dummy.mp4", mock_tracker, mock_embedder, detect_interval=1)

        track_ids = {e["trackId"] for e in result.track_events}
        self.assertIn(1, track_ids)
        self.assertIn(2, track_ids)
        self.assertEqual(len(result.reid_crops), 2)
        print("✔ No-merge (dissimilar) test passed!")


if __name__ == "__main__":
    unittest.main()
