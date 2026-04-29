from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class FailureCode(StrEnum):
    TEMP_IMAGE_MISSING = "TEMP_IMAGE_MISSING"
    INVALID_IMAGE = "INVALID_IMAGE"
    UNSUPPORTED_IMAGE_FORMAT = "UNSUPPORTED_IMAGE_FORMAT"
    IMAGE_TOO_LARGE = "IMAGE_TOO_LARGE"
    DECODE_FAILED = "DECODE_FAILED"
    CATEGORY_UNDETECTED = "CATEGORY_UNDETECTED"
    LAYOUT_UNSUPPORTED = "LAYOUT_UNSUPPORTED"
    OCR_TIMEOUT = "OCR_TIMEOUT"
    OCR_ENGINE_UNAVAILABLE = "OCR_ENGINE_UNAVAILABLE"
    PARSER_FAILED = "PARSER_FAILED"
    DB_WRITE_FAILED = "DB_WRITE_FAILED"
    QUEUE_FAILURE = "QUEUE_FAILURE"


@dataclass(frozen=True)
class OcrFailure:
    code: FailureCode
    message: str
    retryable: bool = False
    user_action: str | None = None


@dataclass(frozen=True)
class OcrError(Exception):
    code: FailureCode
    message: str
    retryable: bool = False
    user_action: str | None = None

    def to_failure(self) -> OcrFailure:
        return OcrFailure(
            code=self.code,
            message=self.message,
            retryable=self.retryable,
            user_action=self.user_action,
        )
