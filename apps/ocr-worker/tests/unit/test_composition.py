import pytest

from momo_ocr.app.composition import _with_sslmode_require, text_recognition_engine_from_env
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.features.text_recognition.tesserocr_engine import TesserocrEngine
from momo_ocr.shared.errors import FailureCode, OcrError


def test_adds_sslmode_require_for_remote_host() -> None:
    url = "postgres://user:pass@db.neon.tech/mydb"
    result = _with_sslmode_require(url)
    assert "sslmode=require" in result


def test_does_not_add_ssl_for_localhost() -> None:
    url = "postgres://summit:summit@localhost:5433/summit"
    result = _with_sslmode_require(url)
    assert "sslmode" not in result


def test_does_not_add_ssl_for_127_0_0_1() -> None:
    url = "postgres://summit:summit@127.0.0.1:5433/summit"
    result = _with_sslmode_require(url)
    assert "sslmode" not in result


def test_respects_explicit_sslmode_in_url() -> None:
    url = "postgres://user:pass@db.neon.tech/mydb?sslmode=disable"
    result = _with_sslmode_require(url)
    assert "sslmode=disable" in result
    assert result.count("sslmode=") == 1


def test_text_recognition_engine_default_is_tesserocr() -> None:
    """After Phase C canary parity, the default engine flipped to tesserocr."""
    engine = text_recognition_engine_from_env(None)
    assert isinstance(engine, TesserocrEngine)
    engine.close()


def test_text_recognition_engine_subprocess_override() -> None:
    engine = text_recognition_engine_from_env("subprocess")
    assert isinstance(engine, TesseractEngine)


def test_text_recognition_engine_unknown_value_raises() -> None:
    with pytest.raises(OcrError) as excinfo:
        text_recognition_engine_from_env("paddleocr")
    assert excinfo.value.code is FailureCode.OCR_ENGINE_UNAVAILABLE
