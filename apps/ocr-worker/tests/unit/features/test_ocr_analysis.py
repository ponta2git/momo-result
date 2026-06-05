from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

import momo_ocr.features.ocr_analysis.analyze_image as analyze_module
from momo_ocr.features.ocr_analysis.analyze_image import analyze_image
from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.ocr_results.parsing import ParserRegistry, ScreenParseContext
from momo_ocr.features.temp_images.validation import MAX_IMAGE_BYTES
from momo_ocr.features.text_recognition.engine import FakeTextRecognitionEngine
from tests.support.images import write_test_image


def test_analyze_image_returns_metadata_and_parser_result(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    write_test_image(image_path, size=(1920, 1080))

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


def test_analyze_image_closes_decoded_image_after_parse(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    write_test_image(image_path)
    parsed_images: list[Image.Image] = []

    class _CapturingParser:
        @property
        def screen_type(self) -> ScreenType:
            return ScreenType.TOTAL_ASSETS

        def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
            image = context.image
            assert image is not None
            assert image.getbbox() is not None
            parsed_images.append(image)
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
    assert len(parsed_images) == 1
    with pytest.raises(ValueError, match="closed image"):
        parsed_images[0].getbbox()


def test_analyze_image_closes_default_text_engine(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_path = tmp_path / "assets.jpg"
    write_test_image(image_path)
    closes: list[str] = []
    text_engine = _ClosableFakeEngine("ぽんた社長 1万円", closes)

    monkeypatch.setattr(
        analyze_module,
        "default_text_recognition_engine",
        lambda: text_engine,
    )

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
    )

    assert result.failure_code is None
    assert closes == ["close"]


def test_analyze_image_can_use_fake_engine_for_auto_detection(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    debug_dir = tmp_path / "debug"
    write_test_image(image_path)

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
    write_test_image(image_path)
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
    write_test_image(image_path)
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


def test_analyze_image_forwards_explicit_fast_path_flag(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    write_test_image(image_path)
    captured_flags: list[bool] = []

    class _CapturingParser:
        @property
        def screen_type(self) -> ScreenType:
            return ScreenType.TOTAL_ASSETS

        def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
            captured_flags.append(context.fast_path_enabled)
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
        fast_path_enabled=True,
    )

    assert result.failure_code is None
    assert captured_flags == [True]


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
    write_test_image(image_path)

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
        text_engine=FakeTextRecognitionEngine("unused"),
        image_root=image_root,
    )

    assert result.failure_code == "QUEUE_FAILURE"


class _ClosableFakeEngine(FakeTextRecognitionEngine):
    def __init__(self, text: str, closes: list[str]) -> None:
        super().__init__(text)
        self._closes = closes

    def close(self) -> None:
        self._closes.append("close")
