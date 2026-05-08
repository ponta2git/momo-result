"""Terminal-failure persistence for OCR jobs.

Splits out of ``runner`` so that the wire-loop can record a doomed
delivery as ``FAILED`` without re-implementing the QUEUED→RUNNING→FAILED
transition itself.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from momo_ocr.features.ocr_jobs.models import OcrJobExecutionResult, OcrJobRecord, OcrJobStatus
from momo_ocr.shared.errors import OcrFailure

if TYPE_CHECKING:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies

logger = logging.getLogger(__name__)


def record_terminal_failure(
    deps: JobRunnerDependencies,
    job_id: str,
    failure: OcrFailure,
) -> bool:
    """Persist a terminal ``FAILED`` status, transitioning through RUNNING if needed."""
    read_succeeded, record = _read_record_for_failure(deps, job_id, failure)
    if not read_succeeded:
        persisted = False
    elif record is None or record.status not in {OcrJobStatus.QUEUED, OcrJobStatus.RUNNING}:
        persisted = True
    elif record.status is OcrJobStatus.QUEUED and not _transition_to_running_for_failure(
        deps,
        job_id,
        failure,
    ):
        persisted = False
    else:
        persisted = _transition_to_failed(deps, job_id, failure)
    return persisted


def _read_record_for_failure(
    deps: JobRunnerDependencies,
    job_id: str,
    failure: OcrFailure,
) -> tuple[bool, OcrJobRecord | None]:
    try:
        return True, deps.repository.get_for_update(job_id)
    except Exception:
        logger.exception(
            "Failed to read OCR job before terminal-failure recording",
            extra={"job_id": job_id, "failure_code": failure.code.value},
        )
        return False, None


def _transition_to_running_for_failure(
    deps: JobRunnerDependencies,
    job_id: str,
    failure: OcrFailure,
) -> bool:
    # Move to RUNNING first so the lifecycle invariants hold; this also
    # records the worker that picked up the doomed delivery.
    try:
        deps.repository.transition_to_running(job_id, worker_id=deps.worker_id)
    except Exception:
        logger.exception(
            "Failed to transition job to RUNNING for terminal-failure recording",
            extra={"job_id": job_id, "failure_code": failure.code.value},
        )
        return False
    return True


def _transition_to_failed(
    deps: JobRunnerDependencies,
    job_id: str,
    failure: OcrFailure,
) -> bool:
    try:
        deps.repository.transition_to_failed_terminal(
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
        return False
    return True
