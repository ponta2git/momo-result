from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from PIL import Image

from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_results.payload_warnings import attach_warnings_to_payload
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


def test_attach_warnings_to_payload_preserves_payload_when_no_runtime_warning() -> None:
    payload = _payload_with_warning()

    merged = attach_warnings_to_payload(payload, [])

    assert merged is payload


def test_attach_warnings_to_payload_merges_unique_runtime_warnings() -> None:
    payload = _payload_with_warning()
    runtime_warning = OcrWarning(
        code=WarningCode.MISSING_AMOUNT,
        message="Could not read total assets for rank 1.",
        field_path="players[0].total_assets_man_yen",
    )

    merged = attach_warnings_to_payload(payload, [runtime_warning])

    assert merged is not payload
    assert merged.requested_screen_type is ScreenType.TOTAL_ASSETS
    assert merged.detected_screen_type is ScreenType.TOTAL_ASSETS
    assert merged.profile_id == "full-hd-total-assets-v1"
    assert merged.players == payload.players
    assert merged.category_payload == {"rank": OcrField(value=1)}
    assert merged.raw_snippets == {"rank_1": "ぽんた社長 ?万円"}
    assert merged.warnings == [payload.warnings[0], runtime_warning]


def test_attach_warnings_to_payload_deduplicates_by_contract_identity() -> None:
    existing = OcrWarning(
        code=WarningCode.MISSING_AMOUNT,
        message="Could not read total assets for rank 1.",
        field_path="players[0].total_assets_man_yen",
    )
    duplicate = OcrWarning(
        code=WarningCode.MISSING_AMOUNT,
        message="Could not read total assets for rank 1.",
        field_path="players[0].total_assets_man_yen",
    )
    distinct_same_field = OcrWarning(
        code=WarningCode.LOW_CONFIDENCE,
        message="Low confidence for rank 1.",
        field_path="players[0].total_assets_man_yen",
    )
    payload = _payload_with_warning(existing)

    merged = attach_warnings_to_payload(payload, [duplicate, distinct_same_field])

    assert merged.warnings == [existing, distinct_same_field]


def _payload_with_warning(warning: OcrWarning | None = None) -> OcrDraftPayload:
    return OcrDraftPayload(
        requested_screen_type=ScreenType.TOTAL_ASSETS,
        detected_screen_type=ScreenType.TOTAL_ASSETS,
        profile_id="full-hd-total-assets-v1",
        players=[
            PlayerResultDraft(
                raw_player_name=OcrField(value="ぽんた"),
                rank=OcrField(value=1),
                total_assets_man_yen=OcrField(value=None, raw_text="?万円"),
            )
        ],
        category_payload={"rank": OcrField(value=1)},
        warnings=[
            warning
            or OcrWarning(
                code=WarningCode.LOW_CONFIDENCE,
                message="Low confidence in rank 1.",
                field_path="players[0].total_assets_man_yen",
            )
        ],
        raw_snippets={"rank_1": "ぽんた社長 ?万円"},
    )


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
