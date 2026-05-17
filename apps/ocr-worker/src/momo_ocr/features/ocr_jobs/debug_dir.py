"""Helpers for resolving per-job OCR debug output paths."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def resolve_debug_dir(job_id: object, image_path: Path, *, base_dir: Path | None) -> Path | None:
    """Return a per-job debug directory when a base directory is configured.

    DEBUG: opt-in。base が未設定なら `None` を返し、本番パイプラインに一切の
    副作用を与えない。設定時は ``<base>/<image_stem>__<job_id>/`` を返し、
    ファイル名から該当画像のディレクトリを特定しやすくする。環境変数の読み取りは
    app/config 境界で行い、この関数は渡された設定だけを扱う。
    """
    if base_dir is None:
        return None
    safe_id = _sanitize_debug_segment(str(job_id))
    safe_stem = _sanitize_debug_segment(image_path.stem) or "image"
    debug_dir = base_dir / f"{safe_stem}__{safe_id}"
    try:
        debug_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.warning("Failed to create MOMO_OCR_DEBUG_DIR; disabling debug dump")
        return None
    return debug_dir


def _sanitize_debug_segment(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value)
