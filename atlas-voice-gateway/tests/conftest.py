"""Make the gateway package importable when running ``pytest tests``.

Tests live in ``atlas-voice-gateway/tests`` and import the ``app`` package from
the project root, so the parent directory is placed on ``sys.path``.
"""

import os
import sys

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)