from __future__ import annotations

from pathlib import Path

from momo_ocr.features.ocr_results.models import ImageType
from momo_ocr.features.ocr_results.parsing import ParseContext
from momo_ocr.features.ocr_results.registry import default_parser_registry


def test_default_parser_registry_returns_category_parser() -> None:
    parser = default_parser_registry().get(ImageType.TOTAL_ASSETS)

    assert parser.image_type == ImageType.TOTAL_ASSETS


def test_category_parser_returns_pending_payload_with_profile_context() -> None:
    parser = default_parser_registry().get(ImageType.REVENUE)

    payload = parser.parse(
        ParseContext(
            image_path=Path("sample.jpg"),
            requested_image_type=ImageType.AUTO,
            detected_image_type=ImageType.REVENUE,
            profile_id="full-hd-revenue-v1",
            debug_dir=None,
            include_raw_text=False,
        )
    )

    assert payload.requested_image_type == ImageType.AUTO
    assert payload.detected_image_type == ImageType.REVENUE
    assert payload.profile_id == "full-hd-revenue-v1"
    assert payload.category_payload["status"] == "pending_parser"
    assert payload.category_payload["parser"] == "revenue"
