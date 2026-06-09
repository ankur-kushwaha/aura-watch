#!/usr/bin/env python3
"""Export YOLOv8n to CoreML — wrapper around export_model.py coreml."""

from __future__ import annotations

import os
import subprocess
import sys

subprocess.run(
    [sys.executable, os.path.join(os.path.dirname(__file__), "export_model.py"), "coreml", *sys.argv[1:]],
    check=True,
)
