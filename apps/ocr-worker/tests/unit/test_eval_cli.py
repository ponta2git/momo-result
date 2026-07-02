from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

import pytest

from momo_ocr.features.ocr_analysis.report import AnalysisResult


def test_eval_cli_closes_built_text_engine(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eval_cli = _import_eval_cli(monkeypatch)
    samples_dir = tmp_path / "samples"
    samples_dir.mkdir()
    answers_path = tmp_path / "answers.tsv"
    answers_path.write_text("unused\n", encoding="utf-8")
    closes: list[str] = []
    text_engine = _ClosableEngine(closes)

    monkeypatch.setattr(eval_cli, "default_text_recognition_engine", lambda: text_engine)
    monkeypatch.setattr(eval_cli, "load_answers", lambda _path: {})
    monkeypatch.setattr(eval_cli, "select_files", lambda *_args: [_Meta(match_no=1)])
    monkeypatch.setattr(eval_cli, "resolve_debug_dir", lambda *_args: None)
    monkeypatch.setattr(eval_cli, "evaluate_one", lambda **_kwargs: _EvalRecord())
    monkeypatch.setattr(eval_cli, "aggregate", lambda _records: {"failures": 0})

    exit_code = eval_cli.main(
        [
            "--samples-dir",
            str(samples_dir),
            "--answers",
            str(answers_path),
            "--summary-only",
        ]
    )

    assert exit_code == 0
    assert closes == ["close"]


def test_evaluate_one_passes_filename_layout_family_hint(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eval_runner = _import_eval_runner(monkeypatch)
    sample_dir = tmp_path / "003_桃鉄2"
    sample_dir.mkdir()
    image_path = sample_dir / "桃鉄2_001_20260703_東日本_01総資産.png"
    image_path.write_bytes(b"unused")
    meta = eval_runner.parse_filename(image_path)
    assert meta is not None
    captured: dict[str, object] = {}

    def analyze_image(**kwargs: object) -> AnalysisResult:
        captured.update(kwargs)
        return AnalysisResult(
            input=None,
            detection=None,
            result=None,
            warnings=[],
            failure_code=None,
            failure_message=None,
            failure_retryable=False,
            failure_user_action=None,
            timings_ms={},
        )

    monkeypatch.setattr(eval_runner, "analyze_image", analyze_image)

    eval_runner.evaluate_one(
        meta=meta,
        expected_players=None,
        debug_dir=None,
        repeat=1,
        text_engine=_ClosableEngine([]),
    )

    assert captured["layout_family_hint"] == "momotetsu_2"


class _EvalCliModule(Protocol):
    def main(self, argv: list[str] | None = None) -> int:
        raise NotImplementedError


class _EvalRunnerModule(Protocol):
    def parse_filename(self, path: Path) -> object | None:
        raise NotImplementedError

    def evaluate_one(
        self,
        *,
        meta: object,
        expected_players: object | None,
        debug_dir: Path | None,
        repeat: int,
        text_engine: object,
    ) -> object:
        raise NotImplementedError


def _import_eval_cli(monkeypatch: pytest.MonkeyPatch) -> _EvalCliModule:
    ocr_worker_root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(ocr_worker_root / "scripts"))
    return cast("_EvalCliModule", importlib.import_module("eval_lib.cli"))


def _import_eval_runner(monkeypatch: pytest.MonkeyPatch) -> _EvalRunnerModule:
    ocr_worker_root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(ocr_worker_root / "scripts"))
    return cast("_EvalRunnerModule", importlib.import_module("eval_lib.runner"))


@dataclass(frozen=True)
class _Meta:
    match_no: int


@dataclass(frozen=True)
class _EvalRecord:
    file: str = "sample.png"


class _ClosableEngine:
    def __init__(self, closes: list[str]) -> None:
        self._closes = closes

    def close(self) -> None:
        self._closes.append("close")
