from __future__ import annotations

from pathlib import Path

from momo_ocr.app.composition import default_parser_registry
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext


def test_default_parser_registry_returns_category_parser() -> None:
    parser = default_parser_registry().get(ScreenType.TOTAL_ASSETS)

    assert parser.screen_type == ScreenType.TOTAL_ASSETS


def test_category_parser_returns_pending_payload_with_profile_context() -> None:
    parser = default_parser_registry().get(ScreenType.REVENUE)

    payload = parser.parse(
        ScreenParseContext(
            image_path=Path("sample.jpg"),
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.REVENUE,
            profile_id="full-hd-revenue-v1",
            debug_dir=None,
            include_raw_text=False,
        )
    )

    assert payload.requested_screen_type == ScreenType.AUTO
    assert payload.detected_screen_type == ScreenType.REVENUE
    assert payload.profile_id == "full-hd-revenue-v1"
    assert payload.category_payload["status"] == "pending_parser"
    assert payload.category_payload["parser"] == "revenue"
