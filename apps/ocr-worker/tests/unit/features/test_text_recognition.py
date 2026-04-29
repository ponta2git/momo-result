from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.shared.errors import FailureCode, OcrError


def test_tesseract_engine_uses_field_config_and_postprocessors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[list[str], float]] = []

    def fake_which(executable: str) -> str:
        assert executable == "tesseract"
        return "/usr/bin/tesseract"

    def fake_run(
        command: list[str],
        *,
        check: bool,
        capture_output: bool,
        text: bool,
        timeout: float,
    ) -> subprocess.CompletedProcess[str]:
        assert check
        assert capture_output
        assert text
        calls.append((command, timeout))
        # Combined-output mode: tesseract writes outbase.txt and outbase.tsv.
        # The command's third positional arg is the output base (no extension).
        output_base = Path(command[2])
        output_base.with_suffix(".txt").write_text("12 34\n", encoding="utf-8")
        output_base.with_suffix(".tsv").write_text(
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\t"
            "left\ttop\twidth\theight\tconf\ttext\n"
            "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\t12\n"
            "5\t1\t1\t1\t1\t2\t20\t0\t10\t10\t80\t34\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(shutil, "which", fake_which)
    monkeypatch.setattr(subprocess, "run", fake_run)

    image = Image.new("RGB", (20, 10), color="white")
    result = TesseractEngine().recognize(
        image,
        field=RecognitionField.MONEY,
        config=RecognitionConfig(
            timeout_seconds=2.0,
            postprocessors=(_remove_spaces,),
        ),
    )

    assert len(calls) == 1
    command, timeout = calls[0]
    assert Path(command[0]) == Path("/usr/bin/tesseract")
    assert command[3:] == [
        "-l",
        "eng",
        "--oem",
        "1",
        "--psm",
        "7",
        "-c",
        "tessedit_char_whitelist=0123456789,-. ",
        "txt",
        "tsv",
    ]
    assert timeout == 2.0
    assert result.raw_text == "12 34"
    assert result.text == "1234"
    assert result.confidence is not None
    assert 0.84 < result.confidence < 0.86


def test_tesseract_engine_reports_missing_executable(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_which(executable: str) -> None:
        assert executable == "tesseract"

    monkeypatch.setattr(shutil, "which", fake_which)

    with pytest.raises(OcrError) as exc_info:
        TesseractEngine().recognize(Image.new("RGB", (1, 1)))

    assert exc_info.value.code == FailureCode.OCR_ENGINE_UNAVAILABLE
    assert exc_info.value.user_action is not None


def test_tesseract_engine_reports_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_which(executable: str) -> str:
        assert executable == "tesseract"
        return "/usr/bin/tesseract"

    def fake_run(
        command: list[str],
        *,
        check: bool,
        capture_output: bool,
        text: bool,
        timeout: float,
    ) -> subprocess.CompletedProcess[str]:
        del check, capture_output, text
        raise subprocess.TimeoutExpired(cmd=command, timeout=timeout)

    monkeypatch.setattr(shutil, "which", fake_which)
    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(OcrError) as exc_info:
        TesseractEngine().recognize(
            Image.new("RGB", (1, 1)),
            config=RecognitionConfig(timeout_seconds=1.0),
        )

    assert exc_info.value.code == FailureCode.OCR_TIMEOUT
    assert exc_info.value.retryable


def _remove_spaces(text: str) -> str:
    return text.replace(" ", "")


def _make_tesseract_engine_with_stdout(
    monkeypatch: pytest.MonkeyPatch, stdout: str, *, text_stdout: str | None = None
) -> TesseractEngine:
    def fake_which(executable: str) -> str:
        assert executable == "tesseract"
        return "/usr/bin/tesseract"

    def fake_run(
        command: list[str],
        *,
        check: bool,
        capture_output: bool,
        text: bool,
        timeout: float,
    ) -> subprocess.CompletedProcess[str]:
        del check, capture_output, text, timeout
        # Combined-output mode: tesseract writes outbase.txt and outbase.tsv.
        output_base = Path(command[2])
        plain = text_stdout if text_stdout is not None else stdout
        output_base.with_suffix(".txt").write_text(plain, encoding="utf-8")
        output_base.with_suffix(".tsv").write_text(stdout, encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(shutil, "which", fake_which)
    monkeypatch.setattr(subprocess, "run", fake_run)
    return TesseractEngine()


def test_tesseract_engine_returns_none_confidence_for_empty_stdout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _make_tesseract_engine_with_stdout(monkeypatch, "")
    result = engine.recognize(Image.new("RGB", (1, 1)))
    assert result.text == ""
    assert result.confidence is None


def test_tesseract_engine_falls_back_when_tsv_header_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Plain stdout (no TSV header) must not crash and must surface the
    # text as-is with unknown confidence so that the rest of the pipeline
    # keeps working even if the tesseract version omits required columns.
    engine = _make_tesseract_engine_with_stdout(monkeypatch, "12 34\n")
    result = engine.recognize(Image.new("RGB", (1, 1)))
    assert result.raw_text == "12 34"
    assert result.confidence is None


def test_tesseract_engine_aggregates_word_confidence_excluding_negatives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stdout = (
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\t"
        "left\ttop\twidth\theight\tconf\ttext\n"
        # Non-word rows (level != 5) and negative confidences must be ignored.
        "1\t1\t0\t0\t0\t0\t0\t0\t0\t0\t-1\t\n"
        "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t60\tA\n"
        "5\t1\t1\t1\t1\t2\t11\t0\t10\t10\t-1\t\n"
        "5\t1\t1\t1\t2\t1\t0\t10\t10\t10\t100\tB\n"
    )
    engine = _make_tesseract_engine_with_stdout(monkeypatch, stdout, text_stdout="A\nB\n")
    result = engine.recognize(Image.new("RGB", (1, 1)))
    # Empty text on the second word row is dropped; line break preserved.
    assert result.raw_text == "A\nB"
    assert result.confidence is not None
    assert 0.79 < result.confidence < 0.81  # mean(60, 100) / 100 == 0.80
