"""Terminal-failure persistence for OCR jobs.

Splits out of ``runner`` so that the wire-loop can record a doomed
delivery as ``FAILED`` without re-implementing the QUEUED→RUNNING→FAILED
transition itself.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from momo_ocr.features.ocr_jobs.models import OcrJobExecutionResult, OcrJobMessage, OcrJobStatus
from momo_ocr.shared.errors import OcrError, OcrFailure

if TYPE_CHECKING:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies

logger = logging.getLogger(__name__)


def record_terminal_failure(
    deps: JobRunnerDependencies,
    message: OcrJobMessage,
    failure: OcrFailure,
) -> None:
    """Persist a terminal ``FAILED`` status, transitioning through RUNNING if needed."""
    record = deps.repository.get_for_update(message.job_id)
    if record is None:
        return
    if record.status not in {OcrJobStatus.QUEUED, OcrJobStatus.RUNNING}:
        return
    if record.status is OcrJobStatus.QUEUED:
        # Move to RUNNING first so the lifecycle invariants hold; this also
        # records the worker that picked up the doomed delivery.
        try:
            deps.repository.transition_to_running(message.job_id, worker_id=deps.worker_id)
        except OcrError:
            logger.exception(
                "Failed to transition job to RUNNING for terminal-failure recording",
                extra={"job_id": message.job_id},
            )
            return
    try:
        deps.repository.transition_to_failed_terminal(
            message.job_id,
            OcrJobExecutionResult(
                status=OcrJobStatus.FAILED,
                draft_payload=None,
                failure=failure,
                warnings=[],
                duration_ms=0.0,
            ),
        )
    except OcrError:
        logger.exception(
            "Failed to persist terminal failure for OCR job",
            extra={"job_id": message.job_id},
        )
