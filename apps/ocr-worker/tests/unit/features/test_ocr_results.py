from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from PIL import Image

from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_results.ranked_row_ocr import recognize_ranked_row_text
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)
from momo_ocr.shared.json import JsonValue, to_jsonable


def test_ocr_draft_payload_serializes_warning_and_field_values() -> None:
    payload = OcrDraftPayload(
        requested_screen_type=ScreenType.TOTAL_ASSETS,
        detected_screen_type=ScreenType.TOTAL_ASSETS,
        profile_id="full-hd-total-assets-v1",
        category_payload={"rank": OcrField(value=1, raw_text="1", confidence=0.95)},
        warnings=[
            OcrWarning(
                code=WarningCode.LOW_CONFIDENCE,
                message="needs review",
                field_path="players[0].rank",
            )
        ],
    )

    jsonable = to_jsonable(payload)
    root = cast("dict[str, JsonValue]", jsonable)
    category_payload = cast("dict[str, JsonValue]", root["category_payload"])
    rank = cast("dict[str, JsonValue]", category_payload["rank"])
    warnings = cast("list[JsonValue]", root["warnings"])
    first_warning = cast("dict[str, JsonValue]", warnings[0])

    assert root["requested_screen_type"] == "total_assets"
    assert rank["value"] == 1
    assert first_warning["code"] == "LOW_CONFIDENCE"


def test_ranked_row_ocr_uses_sparse_text_fallback_when_standard_psms_miss() -> None:
    engine = SequenceTextRecognitionEngine(
        ["noise", "noise", "noise", "noise", "noise", "noise", "オータカ社長 6930万円"]
    )

    result = recognize_ranked_row_text(
        Image.new("RGB", (1280, 120), color="white"),
        text_engine=engine,
        fallback_image=Image.new("RGB", (1280, 120), color="white"),
    )

    assert result.text.endswith("オータカ社長 6930万円")
    assert engine.psms == [6, 7, 6, 7, 6, 7, 11]


class SequenceTextRecognitionEngine(TextRecognitionEngine):
    def __init__(self, texts: Sequence[str]) -> None:
        self._texts = list(texts)
        self.psms: list[int | None] = []

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        del image, field, psm
        self.psms.append(config.psm if config is not None else None)
        return RecognizedText(text=self._texts.pop(0), confidence=0.9)
