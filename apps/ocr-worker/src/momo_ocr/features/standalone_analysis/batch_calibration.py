from __future__ import annotations

from pathlib import Path

from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.report import BatchReport

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def analyze_directory(
    *,
    input_dir: Path,
    expected_dir: Path | None,
    debug_dir: Path | None,
) -> BatchReport:
    del expected_dir
    images = sorted(
        path for path in input_dir.iterdir() if path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    results = [
        analyze_image(
            image_path=image,
            requested_screen_type="auto",
            debug_dir=(debug_dir / image.stem) if debug_dir is not None else None,
            include_raw_text=False,
        )
        for image in images
    ]
    return BatchReport(results=results)
