from __future__ import annotations

from dataclasses import replace

from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.tesserocr_engine import (
    DEFAULT_TESSEROCR_CONFIG,
    TesserocrEngine,
)


def default_text_recognition_engine(*, timeout_seconds: int | None = None) -> TextRecognitionEngine:
    timeout = float(timeout_seconds) if timeout_seconds is not None else None
    config = (
        replace(DEFAULT_TESSEROCR_CONFIG, timeout_seconds=timeout)
        if timeout is not None
        else DEFAULT_TESSEROCR_CONFIG
    )
    return TesserocrEngine(default_config=config)
