from __future__ import annotations

import json
import logging
from typing import Any

# Extra fields, when set on a LogRecord (via `logger.info(..., extra={...})`),
# are surfaced into the JSON output to enable cross-process correlation with
# the API. Keeping the whitelist small avoids accidentally leaking arbitrary
# attributes (e.g. PII or image content) into log sinks.
_EXTRA_KEYS: tuple[str, ...] = ("request_id", "job_id", "draft_id", "image_id", "image_type")


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
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
