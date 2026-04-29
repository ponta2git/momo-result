from __future__ import annotations

from abc import ABC, abstractmethod

from PIL import Image

from momo_ocr.features.text_recognition.models import RecognizedText


class TextRecognitionEngine(ABC):
    @abstractmethod
    def recognize(self, image: Image.Image, *, psm: int | None = None) -> RecognizedText:
        raise NotImplementedError


class FakeTextRecognitionEngine(TextRecognitionEngine):
    def __init__(self, text: str = "") -> None:
        self._text = text

    def recognize(self, image: Image.Image, *, psm: int | None = None) -> RecognizedText:
        del image, psm
        return RecognizedText(text=self._text, confidence=1.0)
