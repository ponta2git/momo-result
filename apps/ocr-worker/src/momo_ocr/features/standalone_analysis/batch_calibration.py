from __future__ import annotations

from pathlib import Path

from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.report import BatchReport
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def analyze_directory(
    *,
    input_dir: Path,
    expected_dir: Path | None,
    debug_dir: Path | None,
    text_engine: TextRecognitionEngine | None = None,
    include_raw_text: bool = False,
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
            include_raw_text=include_raw_text,
            text_engine=text_engine,
        )
        for image in images
    ]
    return BatchReport(results=results)
