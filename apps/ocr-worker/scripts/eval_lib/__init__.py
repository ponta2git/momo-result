"""Internal package for the OCR accuracy evaluator (`eval_accuracy.py`).

Module split:
    - types     : dataclasses + screen-type constants
    - matcher   : expected → predicted player resolution (play_order / name)
    - comparator: per-screen-type field-level diff
    - runner    : filename parsing, answers loading, single-image evaluation,
                  file selection
    - report    : aggregate accuracy + latency percentiles
    - cli       : argparse + orchestrator main()
"""

from __future__ import annotations

from eval_lib.cli import main

__all__ = ["main"]
