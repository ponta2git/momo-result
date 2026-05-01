"""Standalone OCR accuracy evaluator entry-point.

Thin shim that wires `scripts/` into ``sys.path`` so the AI agent can keep
invoking the evaluator with the original command line:

    set -a; source .env; set +a && \\
    MOMO_OCR_DEBUG_DIR=/tmp/momo-ocr-debug \\
    uv run python apps/ocr-worker/scripts/eval_accuracy.py \\
        --samples-dir ocr_samples/003_桃鉄2 \\
        --answers     ocr_samples/003_桃鉄2/answers.tsv \\
        --report      apps/ocr-worker/out/eval-momo2.json \\
        --mode debug

For pure timing measurement (no debug artifacts, repeats per image):

    set -a; source .env; set +a && \\
    uv run python apps/ocr-worker/scripts/eval_accuracy.py \\
        --samples-dir ocr_samples/003_桃鉄2 \\
        --answers     ocr_samples/003_桃鉄2/answers.tsv \\
        --mode timing --repeat 3 \\
        --report      apps/ocr-worker/out/eval-momo2-timing.json

The script intentionally processes every selected image in a single Python
process (no subprocess fan-out) so the AI agent can re-invoke it as a whole
between tuning iterations. ``--repeat`` is provided for inner-loop timing
measurements; outer-loop "run N times and compare" is left to the caller.

Filename convention (e.g. ``桃鉄2_007_20251121_西日本_01総資産_<comment>.jpg``)::

    {game}_{matchNo}_{yyyymmdd}_{map}_{slotPrefix}{slotName}[_{comment}].{ext}

slotPrefix is one of: 01 (総資産) / 02 (収益額) / 03 (事件簿).

Implementation lives in the sibling ``eval_lib`` package.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the in-repo packages importable when invoked via `uv run python ...`.
_SCRIPTS = Path(__file__).resolve().parent
_PKG_SRC = _SCRIPTS.parent / "src"
for path in (_SCRIPTS, _PKG_SRC):
    p = str(path)
    if p not in sys.path:
        sys.path.insert(0, p)

from eval_lib.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
