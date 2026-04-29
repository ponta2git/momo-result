from __future__ import annotations

from typing import cast

from momo_ocr.features.ocr_results.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    WarningCode,
)
from momo_ocr.features.screen_detection.models import ImageType
from momo_ocr.shared.json import JsonValue, to_jsonable


def test_ocr_draft_payload_serializes_warning_and_field_values() -> None:
    payload = OcrDraftPayload(
        requested_image_type=ImageType.TOTAL_ASSETS,
        detected_image_type=ImageType.TOTAL_ASSETS,
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

    assert root["requested_image_type"] == "total_assets"
    assert rank["value"] == 1
    assert first_warning["code"] == "LOW_CONFIDENCE"
