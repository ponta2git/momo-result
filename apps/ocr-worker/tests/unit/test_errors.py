from __future__ import annotations

from momo_ocr.shared.errors import FailureCode, OcrError


def test_ocr_error_exposes_message_to_exception_base() -> None:
    error = OcrError(FailureCode.PARSER_FAILED, "parser failed")

    assert str(error) == "parser failed"
    assert error.args == ("parser failed",)
