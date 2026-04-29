from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.screen_detection.classifier import detect_screen_type
from momo_ocr.features.screen_detection.models import ImageType
from momo_ocr.features.text_recognition.engine import FakeTextRecognitionEngine


def _write_image(path: Path) -> None:
    Image.new("RGB", (1280, 720), color="white").save(path, format="JPEG")


def test_detect_screen_type_honors_requested_type_without_ocr(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    _write_image(image_path)

    result = detect_screen_type(image_path, ImageType.REVENUE)

    assert result.detected_type == ImageType.REVENUE
    assert result.profile_id == "full-hd-revenue-v1"
    assert result.confidence == 1.0


def test_detect_screen_type_uses_title_ocr_evidence(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    _write_image(image_path)

    result = detect_screen_type(
        image_path,
        ImageType.AUTO,
        engine=FakeTextRecognitionEngine("桃鉄事件簿"),
    )

    assert result.detected_type == ImageType.INCIDENT_LOG
    assert result.profile_id == "full-hd-incident-log-v1"
    assert result.confidence == 1.0
    assert result.evidence_text == "桃鉄事件簿"


def test_detect_screen_type_returns_warning_when_title_is_unknown(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    _write_image(image_path)

    result = detect_screen_type(
        image_path,
        ImageType.AUTO,
        engine=FakeTextRecognitionEngine("unknown"),
    )

    assert result.detected_type is None
    assert result.profile_id is None
    assert result.warnings[0].code.value == "AUTO_DETECTION_UNCALIBRATED"
