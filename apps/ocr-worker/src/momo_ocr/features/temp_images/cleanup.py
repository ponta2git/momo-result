from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def delete_if_exists(path: Path) -> bool:
    """Best-effort delete of a temporary OCR image.

    Returns ``True`` when the file existed and was removed. Returns ``False``
    when the file was already absent. OS-level failures are logged and
    surfaced as ``False`` rather than raised: AGENTS.md requires that
    uploaded images are not retained, but a delete failure must not regress
    an already-persisted terminal job status. The caller is expected to
    surface this as a non-fatal warning.
    """
    if not path.exists():
        return False
    try:
        path.unlink()
    except OSError:
        logger.warning("Failed to delete temp OCR image", extra={"path": str(path)})
        return False
    return True
