from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from PIL import Image

from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)

type RecognitionItem = str | tuple[str, float | None]


@dataclass(frozen=True)
class RecognitionCall:
    field: RecognitionField
    psm: int | None
    config_psm: int | None


class SequenceTextRecognitionEngine(TextRecognitionEngine):
    def __init__(
        self,
        items: Sequence[RecognitionItem],
        *,
        default_confidence: float | None = 0.9,
    ) -> None:
        self._items = list(items)
        self._default_confidence = default_confidence
        self.calls: list[RecognitionCall] = []

    @property
    def call_count(self) -> int:
        return len(self.calls)

    @property
    def config_psms(self) -> list[int | None]:
        return [call.config_psm for call in self.calls]

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        del image
        self.calls.append(
            RecognitionCall(
                field=field,
                psm=psm,
                config_psm=config.psm if config is not None else None,
            )
        )
        item = self._items.pop(0)
        if isinstance(item, tuple):
            text, confidence = item
        else:
            text = item
            confidence = self._default_confidence
        return RecognizedText(text=text, confidence=confidence)
