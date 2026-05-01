from __future__ import annotations

import pytest

from momo_ocr.features.text_recognition.fast_path import is_fast_path_enabled


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "YES", "on", "On"])
def test_is_fast_path_enabled_recognises_truthy_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("MOMO_OCR_FAST_PATH", value)
    assert is_fast_path_enabled() is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "anything-else", "  "])
def test_is_fast_path_enabled_recognises_falsy_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("MOMO_OCR_FAST_PATH", value)
    assert is_fast_path_enabled() is False


def test_is_fast_path_enabled_defaults_to_false_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("MOMO_OCR_FAST_PATH", raising=False)
    assert is_fast_path_enabled() is False
