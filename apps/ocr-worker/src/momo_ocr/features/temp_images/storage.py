from __future__ import annotations

from pathlib import Path

from momo_ocr.shared.errors import FailureCode, OcrError


def resolve_local_image(path: Path, *, root: Path | None = None) -> Path:
    resolved = path.expanduser().resolve()
    if root is not None:
        resolved_root = root.expanduser().resolve()
        if not resolved.is_relative_to(resolved_root):
            raise OcrError(
                FailureCode.QUEUE_FAILURE,
                "Image path is outside the configured temporary image directory.",
            )
    return resolved
