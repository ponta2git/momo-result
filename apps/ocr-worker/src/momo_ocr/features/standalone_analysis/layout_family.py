"""Filename-based layout family detection for standalone CLI use.

The worker normally receives ``layoutFamily`` as an OCR hint from the API.
For local calibration/standalone runs, we do not have that hint, so we
use a conservative filename heuristic on the parent directory name. This
must remain a hint and never override OCR evidence in production.
"""

from __future__ import annotations

from pathlib import Path

_DIRECTORY_PATTERNS: tuple[tuple[str, str], ...] = (
    ("桃鉄令和", "reiwa"),
    ("桃鉄ワールド", "world"),
    ("桃鉄2", "momotetsu_2"),
)


def detect_layout_family_from_filename(image_path: Path) -> str | None:
    """Return a layout family hint derived from the image's parent directory name.

    Returns None when no known pattern matches so the parser auto-fallback
    keeps working for unfamiliar samples.
    """
    parent_name = image_path.parent.name
    for needle, family in _DIRECTORY_PATTERNS:
        if needle in parent_name:
            return family
    return None
