from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

import pytest


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


class _EvalCliModule(Protocol):
    def main(self, argv: list[str] | None = None) -> int:
        raise NotImplementedError


def _import_eval_cli(monkeypatch: pytest.MonkeyPatch) -> _EvalCliModule:
    ocr_worker_root = Path(__file__).resolve().parents[2]
    monkeypatch.syspath_prepend(str(ocr_worker_root / "scripts"))
    return cast("_EvalCliModule", importlib.import_module("eval_lib.cli"))


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
