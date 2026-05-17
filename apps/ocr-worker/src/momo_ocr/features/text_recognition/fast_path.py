"""Opt-in performance fast-path flag parsing.

When ``MOMO_OCR_FAST_PATH=1`` (or ``true`` / ``yes`` / ``on``) is set at the
process boundary, OCR call sites that own redundant variant / PSM / profile
loops may terminate early once a confidently-correct answer has already been
produced. This trades a small amount of recall for substantial latency
reduction.

The flag is intentionally *opt-in* so it can be canary-evaluated without
risking the default accuracy gate. Parsing lives here, while runtime code passes
the resulting boolean explicitly through the analysis context.
"""

from __future__ import annotations

_TRUTHY_VALUES: frozenset[str] = frozenset({"1", "true", "yes", "on"})


def parse_fast_path_flag(value: str | None) -> bool:
    """Return True when a raw flag value enables fast-path behavior."""
    return (value or "").strip().lower() in _TRUTHY_VALUES
