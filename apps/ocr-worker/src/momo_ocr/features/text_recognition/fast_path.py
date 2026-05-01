"""Opt-in performance fast-path flag.

When ``MOMO_OCR_FAST_PATH=1`` (or ``true`` / ``yes`` / ``on``) is set in the
environment, OCR call sites that own redundant variant / PSM / profile loops
may terminate early once a confidently-correct answer has already been
produced. This trades a small amount of recall for substantial latency
reduction.

The flag is intentionally *opt-in* so it can be canary-evaluated without
risking the default accuracy gate. Each call site is responsible for
implementing its own short-circuit predicate; this module only owns the env
parsing.

Reading the environment is deliberately not cached: process-wide flags should
not be sticky within a Python session, otherwise tests cannot toggle the flag
via ``monkeypatch.setenv``. ``os.environ.get`` is a sub-microsecond dict
lookup so the per-call cost is negligible relative to a Tesseract invocation.
"""

from __future__ import annotations

import os

_ENV_NAME = "MOMO_OCR_FAST_PATH"
_TRUTHY_VALUES: frozenset[str] = frozenset({"1", "true", "yes", "on"})


def is_fast_path_enabled() -> bool:
    """Return True when the fast-path env flag is enabled."""
    value = os.environ.get(_ENV_NAME, "").strip().lower()
    return value in _TRUTHY_VALUES
