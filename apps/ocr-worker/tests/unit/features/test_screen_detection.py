from __future__ import annotations

from PIL import Image

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.screen_detection.classifier import classify_screen_type
from momo_ocr.features.screen_detection.title_evidence import recognize_title_evidence
from momo_ocr.features.text_recognition.engine import FakeTextRecognitionEngine


def test_classify_screen_type_honors_requested_type_without_evidence() -> None:
    result = classify_screen_type(ScreenType.REVENUE, {})

    assert result.detected_type == ScreenType.REVENUE
    assert result.profile_id == "full-hd-revenue-v1"
    assert result.confidence == 1.0


def test_classify_screen_type_uses_title_ocr_evidence() -> None:
    result = classify_screen_type(
        ScreenType.AUTO,
        {
            ScreenType.TOTAL_ASSETS: "総資産",
            ScreenType.REVENUE: "",
            ScreenType.INCIDENT_LOG: "",
        },
    )

    assert result.detected_type == ScreenType.TOTAL_ASSETS
    assert result.profile_id == "full-hd-total-assets-v1"
    assert result.confidence == 1.0
    assert result.evidence_text == "総資産"


def test_classify_screen_type_uses_incident_table_keywords() -> None:
    result = classify_screen_type(
        ScreenType.AUTO,
        {
            ScreenType.TOTAL_ASSETS: "",
            ScreenType.REVENUE: "",
            ScreenType.INCIDENT_LOG: "目的地 プラス駅 マイナス駅 カード駅",
        },
    )

    assert result.detected_type == ScreenType.INCIDENT_LOG
    assert result.profile_id == "full-hd-incident-log-v1"


def test_classify_screen_type_uses_revenue_title_fragment() -> None:
    result = classify_screen_type(
        ScreenType.AUTO,
        {
            ScreenType.TOTAL_ASSETS: "",
            ScreenType.REVENUE: "tt 額 1年",
            ScreenType.INCIDENT_LOG: "",
        },
    )

    assert result.detected_type == ScreenType.REVENUE


def test_classify_screen_type_returns_warning_when_title_is_unknown() -> None:
    result = classify_screen_type(
        ScreenType.AUTO,
        {
            ScreenType.TOTAL_ASSETS: "unknown",
            ScreenType.REVENUE: "unknown",
            ScreenType.INCIDENT_LOG: "unknown",
        },
    )

    assert result.detected_type is None
    assert result.profile_id is None
    assert result.warnings[0].code.value == "SCREEN_TYPE_UNDETECTED"


def test_recognize_title_evidence_uses_ocr_engine() -> None:
    image = Image.new("RGB", (1280, 720), color="white")

    evidence = recognize_title_evidence(image, FakeTextRecognitionEngine("桃鉄事件簿"))

    assert evidence[ScreenType.INCIDENT_LOG] == "桃鉄事件簿"
