import unittest
from unittest.mock import MagicMock, patch
import sys
import os
import numpy as np

# Add edge directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from clip_processor import cosine_similarity, process_clip
from yolo_tracker import Detection

class TestEdgeAutomerge(unittest.TestCase):
    def test_cosine_similarity(self):
        # Test orthogonal
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0], [0.0, 1.0]), 0.0)
        # Test same
        self.assertAlmostEqual(cosine_similarity([3.0, 4.0], [3.0, 4.0]), 1.0)
        # Test opposing
        self.assertAlmostEqual(cosine_similarity([1.0, 1.0], [-1.0, -1.0]), -1.0)
        # Test zero
        self.assertAlmostEqual(cosine_similarity([0.0, 0.0], [1.0, 1.0]), 0.0)

    @patch('cv2.VideoCapture')
    def test_process_clip_merging(self, mock_vc_class):
        # Mock VideoCapture
        mock_vc = MagicMock()
        mock_vc.isOpened.return_value = True
        mock_vc.get.return_value = 10.0 # FPS
        # Read two frames, then stop
        mock_frame = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_vc.read.side_effect = [
            (True, mock_frame),
            (True, mock_frame),
            (False, None)
        ]
        mock_vc_class.return_value = mock_vc

        # Mock tracker
        mock_tracker = MagicMock()
        mock_tracker.reid_confidence_threshold = 0.5
        # stabilized detections
        det1 = Detection(track_id=1, class_id=0, class_name="person", confidence=0.9, bbox=(0,0,10,10))
        det2 = Detection(track_id=2, class_id=0, class_name="person", confidence=0.9, bbox=(0,0,10,10))

        mock_tracker.process.side_effect = [
            (mock_frame, [det1], True, [det1]),
            (mock_frame, [det2], False, [det2])
        ]

        # Mock embedder
        mock_embedder = MagicMock()
        # Return same embedding for both
        mock_embedder.generate_from_jpeg_bytes.return_value = [1.0, 0.0, 0.0, 0.0]

        # Call process_clip
        result = process_clip(
            "dummy_path.mp4",
            mock_tracker,
            mock_embedder,
            detect_interval=1
        )

        # Assertions
        # Should have run local track merging and grouped them to track 1!
        # Both track events should have trackId = 1
        for event in result.track_events:
            self.assertEqual(event["trackId"], 1)

        # Both crops should have track_id = 1
        for crop in result.reid_crops:
            self.assertEqual(crop.track_id, 1)

        self.assertEqual(len(result.reid_crops), 2)
        print("✔ Edge same-clip automerge unit test passed!")

if __name__ == '__main__':
    unittest.main()
