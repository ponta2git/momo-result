from __future__ import annotations

from momo_ocr.features.ocr_jobs.models import OcrJobStatus
from momo_ocr.shared.errors import FailureCode, OcrError

TERMINAL_STATUSES = {OcrJobStatus.SUCCEEDED, OcrJobStatus.FAILED, OcrJobStatus.CANCELLED}

ALLOWED_TRANSITIONS = {
    OcrJobStatus.QUEUED: {OcrJobStatus.RUNNING, OcrJobStatus.CANCELLED, OcrJobStatus.FAILED},
    OcrJobStatus.RUNNING: {
        OcrJobStatus.SUCCEEDED,
        OcrJobStatus.FAILED,
        OcrJobStatus.CANCELLED,
    },
    OcrJobStatus.SUCCEEDED: set(),
    OcrJobStatus.FAILED: set(),
    OcrJobStatus.CANCELLED: set(),
}


def ensure_transition_allowed(current: OcrJobStatus, target: OcrJobStatus) -> None:
    if target in ALLOWED_TRANSITIONS[current]:
        return
    raise OcrError(
        FailureCode.DB_WRITE_FAILED,
        f"OCR job status cannot transition from {current.value} to {target.value}.",
    )


def is_terminal(status: OcrJobStatus) -> bool:
    return status in TERMINAL_STATUSES
