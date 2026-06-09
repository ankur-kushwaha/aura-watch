#!/usr/bin/env python3
"""Persistent ReID embedding generator using OSNet."""

import sys
import os
import json
import torch

# Add package warning suppression
import warnings
warnings.filterwarnings("ignore")

# Resolve running device
def resolve_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"

try:
    from torchreid.reid.utils import FeatureExtractor
except ImportError:
    # If not imported, we print error to stderr and exit
    print(json.dumps({"error": "torchreid is not installed"}), flush=True)
    sys.exit(1)

def main():
    device = resolve_device()
    try:
        # Load the pre-trained OSNet model (osnet_x1_0)
        extractor = FeatureExtractor(model_name='osnet_x1_0', device=device)
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load OSNet model: {exc}"}), flush=True)
        sys.exit(1)

    # Signal to Node.js that the model is loaded and ready
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

            # FeatureExtractor accepts a list of image paths
            features = extractor([image_path])
            
            # features is a torch.Tensor of shape (1, 512) on the chosen device
            embedding = features[0].cpu().numpy().tolist()
            
            # Print output as a single JSON line
            print(json.dumps(embedding), flush=True)
        except Exception as exc:
            print(json.dumps({"error": f"Inference failed: {exc}"}), flush=True)

if __name__ == "__main__":
    main()
