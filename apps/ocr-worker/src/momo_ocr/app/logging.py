from __future__ import annotations

import json
import logging
import os
from typing import Any

# Extra fields, when set on a LogRecord (via `logger.info(..., extra={...})`),
# are surfaced into the JSON output to enable cross-process correlation with
# the API. Keeping the whitelist small avoids accidentally leaking arbitrary
# attributes (e.g. PII or image content) into log sinks.
_EXTRA_KEYS: tuple[str, ...] = (
    "request_id",
    "job_id",
    "draft_id",
    "image_id",
    "image_type",
    "worker_id",
    "status",
    "failure_code",
    "duration_ms",
    "delivery_tag",
    "resource",
)
_EXC_INFO_MIN_LENGTH = 2
_EXC_INFO_VALUE_INDEX = 1


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "app": "momo-result-ocr-worker",
        }
        for key in _EXTRA_KEYS:
            value = record.__dict__.get(key)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception_classes"] = _exception_classes_from_exc_info(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)


class SafeTextFormatter(logging.Formatter):
    def formatException(self, exc_info: object) -> str:  # noqa: N802 - logging override.
        classes = _exception_classes_from_exc_info(exc_info)
        return f"exception_classes={','.join(classes)}"


def configure_logging(level: int = logging.INFO, *, log_format: str | None = None) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_formatter_for(log_format or os.environ.get("MOMO_LOG_FORMAT", "json")))
    logging.basicConfig(level=level, handlers=[handler], force=True)


def _formatter_for(log_format: str) -> logging.Formatter:
    if log_format.strip().lower() == "text":
        return SafeTextFormatter("%(levelname)s %(name)s %(message)s")
    return JsonFormatter()


def _exception_classes_from_exc_info(exc_info: object) -> list[str]:
    exc = _exception_from_exc_info(exc_info)
    if exc is None:
        return []

    classes: list[str] = []
    current: BaseException | None = exc
    while current is not None:
        classes.append(type(current).__name__)
        if current.__cause__ is not None:
            current = current.__cause__
        elif current.__suppress_context__:
            current = None
        else:
            current = current.__context__
    return classes


def _exception_from_exc_info(exc_info: object) -> BaseException | None:
    if not isinstance(exc_info, tuple) or len(exc_info) < _EXC_INFO_MIN_LENGTH:
        return None
    exc_value = exc_info[_EXC_INFO_VALUE_INDEX]
    return exc_value if isinstance(exc_value, BaseException) else None
