"""Phase A regression tests for the TesseractEngine lifecycle."""

from __future__ import annotations

import io
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.shared.errors import FailureCode, OcrError


def test_init_resolves_executable_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """``shutil.which`` must be called once per engine instance, not per recognize."""
    calls: list[str] = []

    def fake_which(name: str) -> str | None:
        calls.append(name)
        return "/usr/local/bin/" + name

    monkeypatch.setattr(shutil, "which", fake_which)

    engine = TesseractEngine()
    assert calls == ["tesseract"]
    assert engine._executable_path == "/usr/local/bin/tesseract"  # noqa: SLF001


def test_recognize_does_not_call_shutil_which(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hot-path ``recognize`` must rely on the cached executable path."""
    monkeypatch.setattr(shutil, "which", lambda _name: "/bin/tesseract")
    engine = TesseractEngine()

    call_count = {"n": 0}

    def fake_which(_name: str) -> str | None:
        call_count["n"] += 1
        return "/bin/tesseract"

    monkeypatch.setattr(shutil, "which", fake_which)

    # We don't actually need recognize() to succeed; we only want to assert
    # that even if recognize() were entered, it would not call shutil.which.
    # Stub subprocess.run so recognize() short-circuits before doing real OCR.
    class _StubCompleted:
        returncode = 0

    def fake_run(*_args: object, **_kwargs: object) -> _StubCompleted:
        # Write the expected sidecar text file so postprocess succeeds.
        kwargs = _kwargs
        cmd = _args[0] if _args else kwargs.get("args", [])
        # Locate "out" base path passed as second-to-last positional arg.
        out_base = Path(cmd[2])  # type: ignore[index]
        out_base.with_suffix(".txt").write_text("hello\n", encoding="utf-8")
        return _StubCompleted()

    monkeypatch.setattr(subprocess, "run", fake_run)

    image = Image.new("RGB", (10, 10), color="white")
    engine.recognize(image)
    engine.recognize(image)

    assert call_count["n"] == 0


def test_missing_binary_raises_lazily_on_recognize(monkeypatch: pytest.MonkeyPatch) -> None:
    """Construction must not raise even when tesseract is absent."""
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    engine = TesseractEngine()  # must not raise
    image = Image.new("RGB", (10, 10), color="white")
    with pytest.raises(OcrError) as exc_info:
        engine.recognize(image)
    assert exc_info.value.code == FailureCode.OCR_ENGINE_UNAVAILABLE


# Reference io to avoid F401 if other helpers are added later.
_ = io
