from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from PIL import Image

from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)

logger = logging.getLogger(__name__)


class TextRecognitionEngine(ABC):
    @abstractmethod
    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        raise NotImplementedError


class FakeTextRecognitionEngine(TextRecognitionEngine):
    def __init__(self, text: str = "") -> None:
        self._text = text

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        del image, field, psm, config
        return RecognizedText(text=self._text, confidence=1.0)


def close_text_engine(text_engine: object) -> None:
    close_fn = getattr(text_engine, "close", None)
    if not callable(close_fn):
        return
    try:
        close_fn()
    except Exception:
        logger.exception("Failed to close OCR text engine.")
