from __future__ import annotations

import os
from dataclasses import replace

from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.tesseract import DEFAULT_TESSERACT_CONFIG, TesseractEngine
from momo_ocr.features.text_recognition.tesserocr_engine import (
    DEFAULT_TESSEROCR_CONFIG,
    TesserocrEngine,
)
from momo_ocr.shared.errors import FailureCode, OcrError

_ENV_OCR_ENGINE = "MOMO_OCR_ENGINE"
_VALID_ENGINES = ("subprocess", "tesserocr")


def default_text_recognition_engine(*, timeout_seconds: int | None = None) -> TextRecognitionEngine:
    return text_recognition_engine_from_env(
        os.environ.get(_ENV_OCR_ENGINE),
        timeout_seconds=timeout_seconds,
    )


def text_recognition_engine_from_env(
    value: str | None,
    *,
    timeout_seconds: int | None = None,
) -> TextRecognitionEngine:
    """Build the engine selected by ``MOMO_OCR_ENGINE``.

    Default is in-process tesserocr for throughput. Set
    ``MOMO_OCR_ENGINE=subprocess`` when a deployment needs a hard per-call
    process timeout boundary more than the in-process speedup.
    """
    timeout = float(timeout_seconds) if timeout_seconds is not None else None
    name = (value or "tesserocr").strip().lower()
    if name == "subprocess":
        config = (
            replace(DEFAULT_TESSERACT_CONFIG, timeout_seconds=timeout)
            if timeout is not None
            else DEFAULT_TESSERACT_CONFIG
        )
        return TesseractEngine(default_config=config)
    if name == "tesserocr":
        config = (
            replace(DEFAULT_TESSEROCR_CONFIG, timeout_seconds=timeout)
            if timeout is not None
            else DEFAULT_TESSEROCR_CONFIG
        )
        return TesserocrEngine(default_config=config)
    msg = f"Unknown {_ENV_OCR_ENGINE}={value!r}; expected one of {_VALID_ENGINES}."
    raise OcrError(
        FailureCode.OCR_ENGINE_UNAVAILABLE,
        msg,
        retryable=False,
        user_action=f"Set {_ENV_OCR_ENGINE} to 'subprocess' or 'tesserocr'.",
    )
