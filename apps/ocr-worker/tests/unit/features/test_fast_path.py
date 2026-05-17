from __future__ import annotations

import pytest

from momo_ocr.features.text_recognition.fast_path import parse_fast_path_flag


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "YES", "on", "On"])
def test_parse_fast_path_flag_recognises_truthy_values(value: str) -> None:
    assert parse_fast_path_flag(value) is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "anything-else", "  "])
def test_parse_fast_path_flag_recognises_falsy_values(value: str) -> None:
    assert parse_fast_path_flag(value) is False


def test_parse_fast_path_flag_defaults_to_false_when_unset() -> None:
    assert parse_fast_path_flag(None) is False
