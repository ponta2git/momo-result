from __future__ import annotations

import os

from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.features.text_recognition.tesserocr_engine import TesserocrEngine
from momo_ocr.shared.errors import FailureCode, OcrError

_ENV_OCR_ENGINE = "MOMO_OCR_ENGINE"
_VALID_ENGINES = ("subprocess", "tesserocr")


def default_text_recognition_engine() -> TextRecognitionEngine:
    return text_recognition_engine_from_env(os.environ.get(_ENV_OCR_ENGINE))


def text_recognition_engine_from_env(value: str | None) -> TextRecognitionEngine:
    """Build the engine selected by ``MOMO_OCR_ENGINE``.

    Default is ``tesserocr`` after canary eval matched subprocess accuracy
    while reducing per-image latency. Set ``MOMO_OCR_ENGINE=subprocess`` to revert.
    """
    name = (value or "tesserocr").strip().lower()
    if name == "subprocess":
        return TesseractEngine()
    if name == "tesserocr":
        return TesserocrEngine()
    msg = f"Unknown {_ENV_OCR_ENGINE}={value!r}; expected one of {_VALID_ENGINES}."
    raise OcrError(
        FailureCode.OCR_ENGINE_UNAVAILABLE,
        msg,
        retryable=False,
        user_action=f"Set {_ENV_OCR_ENGINE} to 'subprocess' or 'tesserocr'.",
    )
