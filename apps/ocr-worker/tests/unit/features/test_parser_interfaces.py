from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.app.composition import default_parser_registry
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.text_recognition.engine import FakeTextRecognitionEngine


def test_default_parser_registry_returns_category_parser() -> None:
    parser = default_parser_registry().get(ScreenType.TOTAL_ASSETS)

    assert parser.screen_type == ScreenType.TOTAL_ASSETS


def test_category_parser_returns_payload_with_profile_context(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    parser = default_parser_registry().get(ScreenType.INCIDENT_LOG)

    payload = parser.parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=FakeTextRecognitionEngine("0"),
        )
    )

    assert payload.requested_screen_type == ScreenType.AUTO
    assert payload.detected_screen_type == ScreenType.INCIDENT_LOG
    assert payload.profile_id == "full-hd-incident-log-v1"
    assert payload.category_payload["status"] == "parsed"
    assert payload.category_payload["parser"] == "incident_log"
