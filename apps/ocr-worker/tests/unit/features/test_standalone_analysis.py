from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.text_recognition.engine import FakeTextRecognitionEngine


def test_analyze_image_returns_metadata_and_parser_result(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    Image.new("RGB", (1920, 1080), color="white").save(image_path, format="JPEG")

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
        text_engine=FakeTextRecognitionEngine("ぽんた社長 1万円"),
    )

    assert result.failure_code is None
    assert result.input is not None
    assert result.input.width == 1920
    assert result.detection is not None
    assert result.detection.profile_id == "full-hd-total-assets-v1"
    assert result.result is not None
    assert result.result.category_payload["status"] == "parsed"


def test_analyze_image_can_use_fake_engine_for_auto_detection(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    debug_dir = tmp_path / "debug"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="auto",
        debug_dir=debug_dir,
        include_raw_text=True,
        text_engine=FakeTextRecognitionEngine("桃鉄事件簿"),
    )

    assert result.failure_code is None
    assert result.detection is not None
    assert result.detection.detected_type == "incident_log"
    assert result.result is not None
    assert result.result.category_payload["include_raw_text"]
    assert (debug_dir / "screen_detection" / "incident_log_title.png").exists()
