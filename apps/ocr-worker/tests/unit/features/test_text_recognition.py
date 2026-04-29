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
        return subprocess.CompletedProcess(command, 0, stdout=" 12  34\n", stderr="")

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

    command, timeout = calls[0]
    assert Path(command[0]) == Path("/usr/bin/tesseract")
    assert command[2:] == [
        "stdout",
        "-l",
        "eng",
        "--oem",
        "1",
        "--psm",
        "7",
        "-c",
        "tessedit_char_whitelist=0123456789,-. ",
    ]
    assert timeout == 2.0
    assert result.raw_text == "12  34"
    assert result.text == "1234"


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
