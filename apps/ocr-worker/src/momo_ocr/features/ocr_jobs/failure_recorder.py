"""Terminal-failure persistence for OCR jobs.

Splits out of ``runner`` so that the wire-loop can record a doomed
delivery as ``FAILED`` without re-implementing the QUEUED→RUNNING→FAILED
transition itself.
"""

from __future__ import annotations

import logging
from enum import Enum

from momo_ocr.features.ocr_jobs.lifecycle import is_terminal
from momo_ocr.features.ocr_jobs.models import OcrJobExecutionResult, OcrJobRecord, OcrJobStatus
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository
from momo_ocr.shared.errors import OcrFailure

logger = logging.getLogger(__name__)


class TerminalFailureRecordingOutcome(Enum):
    """Whether a failure-recording attempt made the queue delivery removable."""

    DELIVERY_CAN_BE_REMOVED = "delivery_can_be_removed"
    LEAVE_DELIVERY_PENDING = "leave_delivery_pending"

    @property
    def delivery_can_be_removed(self) -> bool:
        return self is TerminalFailureRecordingOutcome.DELIVERY_CAN_BE_REMOVED


def record_terminal_failure(
    repository: OcrJobRepository,
    *,
    worker_id: str,
    job_id: str,
    failure: OcrFailure,
) -> TerminalFailureRecordingOutcome:
    """Persist a terminal ``FAILED`` status, transitioning through RUNNING if needed."""
    read_succeeded, record = _read_record_for_failure(repository, job_id, failure)
    if not read_succeeded:
        outcome = TerminalFailureRecordingOutcome.LEAVE_DELIVERY_PENDING
    elif record is None or is_terminal(record.status):
        outcome = TerminalFailureRecordingOutcome.DELIVERY_CAN_BE_REMOVED
    else:
        outcome = _claim_and_transition_to_failed(
            repository,
            worker_id=worker_id,
            job_id=job_id,
            record=record,
            failure=failure,
        )
    return outcome


def _read_record_for_failure(
    repository: OcrJobRepository,
    job_id: str,
    failure: OcrFailure,
) -> tuple[bool, OcrJobRecord | None]:
    try:
        return True, repository.get_record(job_id)
    except Exception:
        logger.exception(
            "Failed to read OCR job before terminal-failure recording",
            extra={"job_id": job_id, "failure_code": failure.code.value},
        )
        return False, None


def _claim_and_transition_to_failed(
    repository: OcrJobRepository,
    *,
    worker_id: str,
    job_id: str,
    record: OcrJobRecord,
    failure: OcrFailure,
) -> TerminalFailureRecordingOutcome:
    claim_succeeded = True
    claimed: OcrJobRecord | None = record
    if record.status is OcrJobStatus.QUEUED:
        claim_succeeded, claimed = _claim_running_for_failure(
            repository,
            worker_id=worker_id,
            job_id=job_id,
            failure=failure,
        )

    if not claim_succeeded:
        outcome = TerminalFailureRecordingOutcome.LEAVE_DELIVERY_PENDING
    elif claimed is None or is_terminal(claimed.status):
        outcome = TerminalFailureRecordingOutcome.DELIVERY_CAN_BE_REMOVED
    elif claimed.status is OcrJobStatus.RUNNING and claimed.worker_id != worker_id:
        logger.warning(
            "Terminal-failure recording skipped because another worker owns the job",
            extra={
                "job_id": job_id,
                "failure_code": failure.code.value,
                "worker_id": claimed.worker_id,
            },
        )
        outcome = TerminalFailureRecordingOutcome.DELIVERY_CAN_BE_REMOVED
    elif claimed.status is OcrJobStatus.RUNNING:
        outcome = _transition_to_failed(repository, job_id, failure)
    else:
        outcome = TerminalFailureRecordingOutcome.LEAVE_DELIVERY_PENDING
    return outcome


def _claim_running_for_failure(
    repository: OcrJobRepository,
    *,
    worker_id: str,
    job_id: str,
    failure: OcrFailure,
) -> tuple[bool, OcrJobRecord | None]:
    try:
        return True, repository.claim_for_running(job_id, worker_id=worker_id)
    except Exception:
        logger.exception(
            "Failed to claim job for terminal-failure recording",
            extra={"job_id": job_id, "failure_code": failure.code.value},
        )
        return False, None


def _transition_to_failed(
    repository: OcrJobRepository,
    job_id: str,
    failure: OcrFailure,
) -> TerminalFailureRecordingOutcome:
    try:
        repository.complete_non_success(
            job_id,
            OcrJobExecutionResult(
                status=OcrJobStatus.FAILED,
                draft_payload=None,
                failure=failure,
                warnings=[],
                duration_ms=0.0,
            ),
        )
    except Exception:
        logger.exception(
            "Failed to persist terminal failure for OCR job",
            extra={"job_id": job_id, "failure_code": failure.code.value},
        )
        return TerminalFailureRecordingOutcome.LEAVE_DELIVERY_PENDING
    return TerminalFailureRecordingOutcome.DELIVERY_CAN_BE_REMOVED
