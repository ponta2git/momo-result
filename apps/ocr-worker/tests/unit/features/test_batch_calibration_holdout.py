"""Tests for the holdout convention in batch calibration (Fix G)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.standalone_analysis.batch_calibration import (
    HOLDOUT_DIRECTORY_NAME,
    analyze_directory,
)
from momo_ocr.features.text_recognition.engine import FakeTextRecognitionEngine


def _write_image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (1280, 720), color="white").save(path, format="JPEG")


def _setup_input(tmp_path: Path) -> Path:
    _write_image(tmp_path / "train_a.jpg")
    _write_image(tmp_path / "train_b.jpg")
    _write_image(tmp_path / HOLDOUT_DIRECTORY_NAME / "holdout_a.jpg")
    return tmp_path


def test_evaluation_set_train_only_scans_top_level(tmp_path: Path) -> None:
    input_dir = _setup_input(tmp_path)
    report = analyze_directory(
        input_dir=input_dir,
        expected_dir=None,
        debug_dir=None,
        text_engine=FakeTextRecognitionEngine(),
        evaluation_set="train",
    )
    stems = {result.input.path.stem for result in report.results if result.input is not None}
    assert stems == {"train_a", "train_b"}


def test_evaluation_set_holdout_only_scans_holdout_subdir(tmp_path: Path) -> None:
    input_dir = _setup_input(tmp_path)
    report = analyze_directory(
        input_dir=input_dir,
        expected_dir=None,
        debug_dir=None,
        text_engine=FakeTextRecognitionEngine(),
        evaluation_set="holdout",
    )
    stems = {result.input.path.stem for result in report.results if result.input is not None}
    assert stems == {"holdout_a"}


def test_evaluation_set_all_unions_train_and_holdout(tmp_path: Path) -> None:
    input_dir = _setup_input(tmp_path)
    report = analyze_directory(
        input_dir=input_dir,
        expected_dir=None,
        debug_dir=None,
        text_engine=FakeTextRecognitionEngine(),
        evaluation_set="all",
    )
    stems = {result.input.path.stem for result in report.results if result.input is not None}
    assert stems == {"train_a", "train_b", "holdout_a"}
