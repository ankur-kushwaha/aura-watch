#!/usr/bin/env python3
"""One-time dev tool: export torchreid OSNet to ONNX for lightweight runtime inference."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUT = BACKEND_DIR / "models" / "osnet_x1_0.onnx"


def export_onnx(output_path: Path) -> None:
    from torchreid.reid.models import build_model

    output_path.parent.mkdir(parents=True, exist_ok=True)

    model = build_model("osnet_x1_0", num_classes=1, pretrained=True, use_gpu=False)
    model.eval()

    dummy = torch.randn(1, 3, 256, 128)
    torch.onnx.export(
        model,
        dummy,
        str(output_path),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=18,
    )
    print(f"Exported ONNX model to {output_path}")


def verify_onnx(output_path: Path) -> None:
    import onnxruntime as ort
    from PIL import Image
    from torchvision import transforms as T

    from torchreid.reid.models import build_model

    torch_model = build_model("osnet_x1_0", num_classes=1, pretrained=True, use_gpu=False)
    torch_model.eval()

    preprocess = T.Compose([
        T.Resize((256, 128)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    rng = np.random.default_rng(0)
    image = Image.fromarray(rng.integers(0, 256, (320, 160, 3), dtype=np.uint8))
    tensor = preprocess(image).unsqueeze(0)

    with torch.no_grad():
        torch_out = torch_model(tensor).numpy()

    session = ort.InferenceSession(str(output_path), providers=["CPUExecutionProvider"])
    onnx_out = session.run(None, {"input": tensor.numpy()})[0]

    max_diff = float(np.max(np.abs(torch_out - onnx_out)))
    print(f"Verification max abs diff: {max_diff:.6f}")
    if max_diff > 1e-4:
        raise SystemExit(f"ONNX output diverges from PyTorch (max diff {max_diff})")
    print("ONNX output matches PyTorch.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export OSNet ReID model to ONNX")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output ONNX path (default: {DEFAULT_OUT})",
    )
    parser.add_argument("--skip-verify", action="store_true")
    args = parser.parse_args()

    try:
        export_onnx(args.output)
        if not args.skip_verify:
            verify_onnx(args.output)
    except Exception as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
