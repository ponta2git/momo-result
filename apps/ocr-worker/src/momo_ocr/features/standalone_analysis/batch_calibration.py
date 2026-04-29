from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Literal

from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.report import BatchReport
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
HOLDOUT_DIRECTORY_NAME = "holdout"

EvaluationSet = Literal["all", "train", "holdout"]
EVALUATION_SET_CHOICES: tuple[EvaluationSet, ...] = ("all", "train", "holdout")


def analyze_directory(
    *,
    input_dir: Path,
    expected_dir: Path | None,
    debug_dir: Path | None,
    text_engine: TextRecognitionEngine | None = None,
    include_raw_text: bool = False,
    evaluation_set: EvaluationSet = "all",
) -> BatchReport:
    """Run the standalone analyzer over a folder of local samples.

    The optional ``holdout/`` subdirectory of ``input_dir`` is the holdout
    convention used by the OCR tuning loop. Images placed inside
    ``holdout/`` are reserved for unbiased accuracy reporting and must
    not influence calibration decisions. ``evaluation_set`` selects which
    slice to analyze:

    * ``train`` (default for tuning): top-level files only.
    * ``holdout``: files under ``holdout/`` only.
    * ``all``: union of both, recursing one level into ``holdout/``.
    """
    del expected_dir
    images = sorted(_iter_images(input_dir, evaluation_set))
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


def _iter_images(input_dir: Path, evaluation_set: EvaluationSet) -> Iterator[Path]:
    if evaluation_set in {"all", "train"}:
        for path in input_dir.iterdir():
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
                yield path
    if evaluation_set in {"all", "holdout"}:
        holdout_dir = input_dir / HOLDOUT_DIRECTORY_NAME
        if holdout_dir.is_dir():
            for path in holdout_dir.iterdir():
                if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
                    yield path
