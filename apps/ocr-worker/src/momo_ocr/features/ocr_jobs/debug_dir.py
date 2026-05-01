"""Helpers for resolving the per-job MOMO_OCR_DEBUG_DIR path."""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def resolve_debug_dir(job_id: object, image_path: Path) -> Path | None:
    """Return a per-job debug directory when MOMO_OCR_DEBUG_DIR is set.

    DEBUG: opt-in。環境変数が未設定/空なら `None` を返し、本番パイプラインに
    一切の副作用を与えない。設定時は ``<base>/<image_stem>__<job_id>/`` を返し、
    ファイル名から該当画像のディレクトリを特定しやすくする。
    """
    base = os.environ.get("MOMO_OCR_DEBUG_DIR", "").strip()
    if not base:
        return None
    safe_id = _sanitize_debug_segment(str(job_id))
    safe_stem = _sanitize_debug_segment(image_path.stem) or "image"
    debug_dir = Path(base).expanduser() / f"{safe_stem}__{safe_id}"
    try:
        debug_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.warning("Failed to create MOMO_OCR_DEBUG_DIR=%s; disabling debug dump", debug_dir)
        return None
    return debug_dir


def _sanitize_debug_segment(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value)
