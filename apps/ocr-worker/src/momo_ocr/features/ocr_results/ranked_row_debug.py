from __future__ import annotations

from pathlib import Path

from PIL import Image


def save_debug_ranked_row(
    *,
    row_image: Image.Image,
    prepared_row: Image.Image,
    debug_dir: Path,
    rank: int,
) -> None:
    row_image.save(debug_dir / f"rank_{rank}_row.png")
    prepared_row.save(debug_dir / f"rank_{rank}_row_prepared.png")
