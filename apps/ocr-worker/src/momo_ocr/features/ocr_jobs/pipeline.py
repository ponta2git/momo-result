"""OCR job state-machine pipeline.

Implements the QUEUED → RUNNING → SUCCEEDED|FAILED|CANCELLED transitions
as a chain of small phase functions. Each phase returns ``None`` to
signal "continue to the next phase" or an :class:`OcrJobStatus` to
short-circuit with a terminal status. ``run_pipeline`` walks the chain
and returns the final status.

Splitting this out of ``runner`` keeps the state-machine invariants
local and individually testable.
"""

from __future__ import annotations

import logging

from momo_ocr.features.ocr_jobs.lifecycle import is_terminal
from momo_ocr.features.ocr_jobs.models import (
    OcrJobMessage,
    OcrJobRecord,
    OcrJobStatus,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.pipeline_dependencies import PipelineDependencies
from momo_ocr.features.ocr_jobs.pipeline_execution import (
    cancelled_result,
    execute_analysis_phase,
)
from momo_ocr.shared.errors import FailureCode, OcrError

logger = logging.getLogger(__name__)


def run_pipeline(deps: PipelineDependencies, delivery: PulledJob) -> OcrJobStatus:
    """Walk the per-delivery state machine and return the terminal status."""
    message = delivery.message

    status = (
        _phase_lookup_record(deps, delivery)
        or _phase_pre_run_cancellation(deps, message)
        or _phase_claim_running(deps, delivery)
        or _phase_post_running_cancellation(deps, message)
    )
    if status is not None:
        return status

    return execute_analysis_phase(deps, message)


def _phase_lookup_record(deps: PipelineDependencies, delivery: PulledJob) -> OcrJobStatus | None:
    """Look up the canonical job record; return a terminal status if not runnable."""
    message = delivery.message
    record = deps.repository.get_record(message.job_id)
    if record is None:
        # The DB is the source of truth; an unknown job_id means the job
        # was never persisted (or was hard-deleted). Ack the delivery so
        # the broker does not redeliver.
        logger.warning(
            "OCR queue message references unknown job; dropping delivery",
            extra={"job_id": message.job_id, "delivery_tag": delivery.delivery_tag},
        )
        return OcrJobStatus.FAILED

    if is_terminal(record.status):
        # Duplicate delivery after a persisted terminal state: DB is the source
        # of truth, so no retry or compensating transition is needed.
        return record.status
    if record.status is OcrJobStatus.RUNNING:
        # Redis may redeliver or XCLAIM a pending message while the original
        # worker still owns the DB job. Treat DB as authoritative and ack this
        # duplicate instead of running OCR twice or writing a false failure.
        logger.warning(
            "OCR queue delivery references an already running job; acknowledging duplicate",
            extra={
                "job_id": message.job_id,
                "delivery_tag": delivery.delivery_tag,
                "worker_id": record.worker_id,
            },
        )
        return record.status
    _ensure_payload_matches_record(message, record)
    return None


def _ensure_payload_matches_record(message: OcrJobMessage, record: OcrJobRecord) -> None:
    mismatched_fields = []
    if message.draft_id != record.draft_id:
        mismatched_fields.append("draftId")
    if message.image_id != record.image_id:
        mismatched_fields.append("imageId")
    if message.image_path != record.image_path:
        mismatched_fields.append("imagePath")
    if message.requested_screen_type is not record.requested_screen_type:
        mismatched_fields.append("requestedScreenType")
    if not mismatched_fields:
        return
    raise OcrError(
        FailureCode.QUEUE_FAILURE,
        f"OCR queue payload does not match DB job record: {', '.join(mismatched_fields)}.",
    )


def _phase_claim_running(deps: PipelineDependencies, delivery: PulledJob) -> OcrJobStatus | None:
    """Claim execution ownership, treating claim races as duplicate deliveries."""
    message = delivery.message
    record = deps.repository.claim_for_running(message.job_id, worker_id=deps.worker_id)
    if record is None:
        logger.warning(
            "OCR job disappeared before worker could claim it; dropping delivery",
            extra={"job_id": message.job_id, "delivery_tag": delivery.delivery_tag},
        )
        return OcrJobStatus.FAILED
    if record.status is OcrJobStatus.RUNNING and record.worker_id == deps.worker_id:
        return None
    if is_terminal(record.status):
        return record.status
    if record.status is OcrJobStatus.RUNNING:
        logger.warning(
            "OCR job claim was lost to another worker; acknowledging duplicate delivery",
            extra={
                "job_id": message.job_id,
                "delivery_tag": delivery.delivery_tag,
                "worker_id": record.worker_id,
            },
        )
        return record.status
    raise OcrError(
        FailureCode.DB_WRITE_FAILED,
        f"OCR job {message.job_id} was not claimed for running.",
        retryable=True,
    )


def _phase_pre_run_cancellation(
    deps: PipelineDependencies, message: OcrJobMessage
) -> OcrJobStatus | None:
    if not deps.cancellation.is_cancelled(message.job_id):
        return None
    return _complete_cancelled_job(deps, message)


def _phase_post_running_cancellation(
    deps: PipelineDependencies, message: OcrJobMessage
) -> OcrJobStatus | None:
    """Honour cancellation that arrived between running claim and OCR start."""
    if not deps.cancellation.is_cancelled(message.job_id):
        return None
    return _complete_cancelled_job(deps, message)


def _complete_cancelled_job(
    deps: PipelineDependencies,
    message: OcrJobMessage,
) -> OcrJobStatus:
    record = deps.repository.get_record(message.job_id)
    if record is None:
        return OcrJobStatus.FAILED
    if is_terminal(record.status):
        return record.status
    try:
        deps.repository.complete_non_success(message.job_id, cancelled_result())
    except OcrError as exc:
        if exc.code is not FailureCode.DB_WRITE_FAILED:
            raise
        refreshed = deps.repository.get_record(message.job_id)
        if refreshed is not None and is_terminal(refreshed.status):
            return refreshed.status
        raise
    return OcrJobStatus.CANCELLED
