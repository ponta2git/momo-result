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


def test_json_formatter_safely_normalizes_extra_fields() -> None:
    formatter = JsonFormatter()
    leaked_marker = "sensitive-object-repr"
    record = logging.getLogger("momo_ocr.test").makeRecord(
        "momo_ocr.test",
        logging.INFO,
        __file__,
        1,
        "operation finished",
        args=(),
        exc_info=None,
        func=None,
        extra={
            "job_id": "j" * 300,
            "duration_ms": float("inf"),
            "concurrency": 2,
            "resource": _SecretRepr(leaked_marker),
        },
    )

    rendered = formatter.format(record)

    payload = cast("dict[str, object]", json.loads(rendered))
    assert isinstance(payload["job_id"], str)
    assert len(payload["job_id"]) == 259
    assert payload["job_id"].endswith("...")
    assert payload["duration_ms"] == "inf"
    assert payload["concurrency"] == 2
    assert payload["resource"] == "_SecretRepr"
    assert leaked_marker not in rendered


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


class _SecretRepr:
    def __init__(self, secret: str) -> None:
        self._secret = secret

    def __repr__(self) -> str:
        return self._secret
