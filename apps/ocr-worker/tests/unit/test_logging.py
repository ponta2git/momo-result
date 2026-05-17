from __future__ import annotations

import json
import logging
import sys
from typing import cast

from momo_ocr.app.logging import JsonFormatter, SafeTextFormatter


def test_json_formatter_logs_exception_classes_without_message_or_traceback() -> None:
    formatter = JsonFormatter()
    rendered = ""

    try:
        _raise_runtime_error_with_secret()
    except RuntimeError:
        rendered = formatter.format(_record_with_current_exception())

    payload = cast("dict[str, object]", json.loads(rendered))
    assert payload["message"] == "operation failed"
    assert payload["exception_classes"] == ["RuntimeError"]
    assert "secret-token" not in rendered
    assert "Traceback" not in rendered


def test_text_formatter_logs_exception_classes_without_message_or_traceback() -> None:
    formatter = SafeTextFormatter("%(levelname)s %(message)s")
    rendered = ""

    try:
        _raise_value_error_with_secret()
    except ValueError:
        rendered = formatter.format(_record_with_current_exception())

    assert "ERROR operation failed" in rendered
    assert "exception_classes=ValueError" in rendered
    assert "database-url-secret" not in rendered
    assert "Traceback" not in rendered


def _record_with_current_exception() -> logging.LogRecord:
    return logging.getLogger("momo_ocr.test").makeRecord(
        "momo_ocr.test",
        logging.ERROR,
        __file__,
        1,
        "operation failed",
        args=(),
        exc_info=sys.exc_info(),
        func=None,
        extra={"job_id": "job-1"},
    )


def _raise_runtime_error_with_secret() -> None:
    message = "secret-token"
    raise RuntimeError(message)


def _raise_value_error_with_secret() -> None:
    message = "database-url-secret"
    raise ValueError(message)
