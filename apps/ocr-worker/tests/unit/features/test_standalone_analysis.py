from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.ocr_results.parsing import ParserRegistry, ScreenParseContext
from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.temp_images.validation import MAX_IMAGE_BYTES
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


def test_analyze_image_does_not_infer_layout_family_from_filename(tmp_path: Path) -> None:
    sample_dir = tmp_path / "003_桃鉄2"
    sample_dir.mkdir()
    image_path = sample_dir / "assets.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    captured_hints: list[str | None] = []

    class _CapturingParser:
        @property
        def screen_type(self) -> ScreenType:
            return ScreenType.TOTAL_ASSETS

        def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
            captured_hints.append(context.layout_family_hint)
            return OcrDraftPayload(
                requested_screen_type=context.requested_screen_type,
                detected_screen_type=context.detected_screen_type,
                profile_id=context.profile_id,
            )

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
        text_engine=FakeTextRecognitionEngine("unused"),
        parser_registry=ParserRegistry({ScreenType.TOTAL_ASSETS: _CapturingParser()}),
    )

    assert result.failure_code is None
    assert captured_hints == [None]


def test_analyze_image_forwards_explicit_layout_family_hint(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    captured_hints: list[str | None] = []

    class _CapturingParser:
        @property
        def screen_type(self) -> ScreenType:
            return ScreenType.TOTAL_ASSETS

        def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
            captured_hints.append(context.layout_family_hint)
            return OcrDraftPayload(
                requested_screen_type=context.requested_screen_type,
                detected_screen_type=context.detected_screen_type,
                profile_id=context.profile_id,
            )

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
        text_engine=FakeTextRecognitionEngine("unused"),
        parser_registry=ParserRegistry({ScreenType.TOTAL_ASSETS: _CapturingParser()}),
        layout_family_hint="momotetsu_2",
    )

    assert result.failure_code is None
    assert captured_hints == ["momotetsu_2"]


def test_analyze_image_returns_temp_image_missing_failure(tmp_path: Path) -> None:
    result = analyze_image(
        image_path=tmp_path / "missing.jpg",
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
        text_engine=FakeTextRecognitionEngine("unused"),
    )

    assert result.failure_code == "TEMP_IMAGE_MISSING"
    assert result.failure_user_action == "Re-upload the screenshot and run OCR again."


def test_analyze_image_enforces_size_limit_when_requested(tmp_path: Path) -> None:
    image_path = tmp_path / "too-large.jpg"
    image_path.write_bytes(b"x" * (MAX_IMAGE_BYTES + 1))

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
        text_engine=FakeTextRecognitionEngine("unused"),
        enforce_size_limit=True,
    )

    assert result.failure_code == "IMAGE_TOO_LARGE"


def test_analyze_image_rejects_path_outside_image_root(tmp_path: Path) -> None:
    image_root = tmp_path / "uploads"
    outside = tmp_path / "outside"
    image_root.mkdir()
    outside.mkdir()
    image_path = outside / "sample.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
        text_engine=FakeTextRecognitionEngine("unused"),
        image_root=image_root,
    )

    assert result.failure_code == "QUEUE_FAILURE"
