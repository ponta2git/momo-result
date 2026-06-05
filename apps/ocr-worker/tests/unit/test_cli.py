from __future__ import annotations

import json
from pathlib import Path

import pytest

from momo_ocr.app import cli as cli_module
from momo_ocr.app.cli import main
from momo_ocr.features.ocr_analysis.report import AnalysisResult, BatchReport
from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.text_recognition.engine import FakeTextRecognitionEngine
from tests.support.images import write_test_image


def test_cli_parser_accepts_all_domain_screen_types() -> None:
    parser = cli_module.build_parser()

    for screen_type in ScreenType:
        args = parser.parse_args(["analyze", "--image", "sample.png", "--type", screen_type.value])

        assert args.type == screen_type.value


def test_cli_analyze_writes_json_and_returns_zero_with_fake_engine(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    output_path = tmp_path / "result.json"
    write_test_image(image_path)

    exit_code = main(
        [
            "analyze",
            "--image",
            str(image_path),
            "--type",
            "auto",
            "--ocr-engine",
            "fake",
            "--fake-text",
            "総資産",
            "--output",
            str(output_path),
        ]
    )

    output = json.loads(output_path.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert output["detection"]["detected_type"] == "total_assets"
    assert output["result"]["category_payload"]["parser"] == "total_assets"


def test_cli_analyze_returns_nonzero_when_auto_detection_cannot_parse(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "unknown.jpg"
    output_path = tmp_path / "result.json"
    write_test_image(image_path)

    exit_code = main(
        [
            "analyze",
            "--image",
            str(image_path),
            "--type",
            "auto",
            "--ocr-engine",
            "fake",
            "--fake-text",
            "unknown",
            "--output",
            str(output_path),
        ]
    )

    output = json.loads(output_path.read_text(encoding="utf-8"))
    assert exit_code == 1
    assert output["detection"]["detected_type"] is None
    assert output["result"] is None


def test_cli_analyze_closes_built_text_engine(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_path = tmp_path / "result.json"
    closes: list[str] = []
    text_engine = _ClosableFakeEngine(closes)

    def build_text_engine(_args: object) -> _ClosableFakeEngine:
        return text_engine

    def analyze_image(**kwargs: object) -> AnalysisResult:
        assert kwargs["text_engine"] is text_engine
        return _successful_analysis_result()

    monkeypatch.setattr(cli_module, "_build_text_engine", build_text_engine)
    monkeypatch.setattr(cli_module, "analyze_image", analyze_image)

    exit_code = main(
        [
            "analyze",
            "--image",
            str(tmp_path / "unused.jpg"),
            "--output",
            str(output_path),
        ]
    )

    assert exit_code == 0
    assert closes == ["close"]


def test_cli_batch_closes_built_text_engine(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report_path = tmp_path / "report.json"
    closes: list[str] = []
    text_engine = _ClosableFakeEngine(closes)

    def build_text_engine(_args: object) -> _ClosableFakeEngine:
        return text_engine

    def analyze_directory(**kwargs: object) -> BatchReport:
        assert kwargs["text_engine"] is text_engine
        return BatchReport(results=[_successful_analysis_result()])

    monkeypatch.setattr(cli_module, "_build_text_engine", build_text_engine)
    monkeypatch.setattr(cli_module, "analyze_directory", analyze_directory)

    exit_code = main(
        [
            "batch",
            "--input-dir",
            str(tmp_path),
            "--report",
            str(report_path),
        ]
    )

    assert exit_code == 0
    assert closes == ["close"]


class _ClosableFakeEngine(FakeTextRecognitionEngine):
    def __init__(self, closes: list[str]) -> None:
        super().__init__("総資産")
        self._closes = closes

    def close(self) -> None:
        self._closes.append("close")


def _successful_analysis_result() -> AnalysisResult:
    return AnalysisResult(
        input=None,
        detection=None,
        result=OcrDraftPayload(
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.TOTAL_ASSETS,
            profile_id="test-profile",
        ),
        warnings=[],
        failure_code=None,
        failure_message=None,
        failure_retryable=False,
        failure_user_action=None,
        timings_ms={},
    )
