"""OCR job runner: top-level wire loop for a single delivery.

Responsibilities are kept to:

1. Pull a delivery from the consumer.
2. Drive :func:`pipeline.run_pipeline` (state-machine + analysis).
3. Convert uncaught application errors into a terminal ``FAILED`` row via
   :func:`failure_recorder.record_terminal_failure`.
4. Acknowledge the queue delivery *only* after the terminal status has
   been written.

State transitions, alias resolution, debug-dir resolution and warning
merging are factored into sibling modules. See those for details.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import cast

import psycopg

from momo_ocr.features.ocr_jobs.delivery_handler import ack_delivery
from momo_ocr.features.ocr_jobs.dependencies import JobRunnerDependencies
from momo_ocr.features.ocr_jobs.failure_recorder import record_terminal_failure
from momo_ocr.features.ocr_jobs.models import (
    MalformedPulledJob,
    MaxAttemptsExceededPulledJob,
    OcrJobStatus,
    OcrQueueDelivery,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.pipeline import run_pipeline
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class JobRunOutcome:
    """Outcome returned to the worker loop for a single iteration."""

    pulled: bool
    job_id: str | None
    status: OcrJobStatus | None
    duration_ms: float


def run_one_job(deps: JobRunnerDependencies) -> JobRunOutcome:
    """Process at most one delivery from the consumer.

    Returns a :class:`JobRunOutcome` describing what happened so the worker
    loop can decide whether to back off or pull another message immediately.
    Any unhandled application exception in the pipeline is converted into a
    terminal ``FAILED`` job; the queue is acked so the broker does not redeliver
    indefinitely (retries are owned by the API/orchestrator). Database
    connection failures are different: the worker cannot know whether a
    terminal state was persisted, so the delivery is left pending for Redis PEL
    recovery instead of being acknowledged.
    """
    delivery = deps.consumer.pull()
    if delivery is None:
        return JobRunOutcome(pulled=False, job_id=None, status=None, duration_ms=0.0)

    control_outcome = _handle_control_delivery(deps, delivery)
    if control_outcome is not None:
        return control_outcome
    delivery = cast("PulledJob", delivery)

    job_id = delivery.message.job_id
    log_extra: dict[str, str] = {"job_id": job_id}
    if delivery.message.request_id:
        log_extra["request_id"] = delivery.message.request_id
    started = time.monotonic()
    should_ack = True
    try:
        outcome_status = run_pipeline(deps, delivery)
    except psycopg.Error:
        logger.exception(
            "Database error in OCR job runner; leaving delivery pending",
            extra=log_extra,
        )
        should_ack = False
        outcome_status = None
    except OcrError as exc:
        should_ack = record_terminal_failure(
            deps.repository,
            worker_id=deps.worker_id,
            job_id=delivery.message.job_id,
            failure=exc.to_failure(),
        )
        outcome_status = OcrJobStatus.FAILED
    except Exception:
        logger.exception("Unhandled error in OCR job runner", extra=log_extra)
        failure = OcrFailure(
            code=FailureCode.PARSER_FAILED,
            message="Unexpected OCR worker error.",
            retryable=False,
        )
        should_ack = record_terminal_failure(
            deps.repository,
            worker_id=deps.worker_id,
            job_id=delivery.message.job_id,
            failure=failure,
        )
        outcome_status = OcrJobStatus.FAILED
    if should_ack:
        ack_delivery(deps.consumer, delivery)
    else:
        logger.error(
            "OCR job did not reach a persisted terminal state; leaving delivery pending",
            extra={"job_id": job_id, "delivery_tag": delivery.delivery_tag},
        )
    duration_ms = (time.monotonic() - started) * 1000.0
    return JobRunOutcome(
        pulled=True,
        job_id=job_id,
        status=outcome_status,
        duration_ms=duration_ms,
    )


def _handle_control_delivery(
    deps: JobRunnerDependencies,
    delivery: OcrQueueDelivery,
) -> JobRunOutcome | None:
    if isinstance(delivery, MalformedPulledJob):
        return _handle_malformed_delivery(deps, delivery)
    if isinstance(delivery, MaxAttemptsExceededPulledJob):
        return _handle_max_attempts_delivery(deps, delivery)
    return None


def _handle_malformed_delivery(
    deps: JobRunnerDependencies,
    delivery: MalformedPulledJob,
) -> JobRunOutcome:
    job_id = delivery.raw_fields.get("jobId")
    should_ack = True
    if job_id:
        should_ack = record_terminal_failure(
            deps.repository,
            worker_id=deps.worker_id,
            job_id=job_id,
            failure=delivery.failure,
        )
    if should_ack:
        ack_delivery(deps.consumer, delivery)
    else:
        logger.error(
            "Malformed OCR queue delivery could not be persisted as failed; leaving pending",
            extra={"job_id": job_id, "delivery_tag": delivery.delivery_tag},
        )
    return JobRunOutcome(
        pulled=True,
        job_id=job_id,
        status=OcrJobStatus.FAILED,
        duration_ms=0.0,
    )


def _handle_max_attempts_delivery(
    deps: JobRunnerDependencies,
    delivery: MaxAttemptsExceededPulledJob,
) -> JobRunOutcome:
    job_id = delivery.raw_fields.get("jobId")
    should_dead_letter = True
    if job_id:
        should_dead_letter = record_terminal_failure(
            deps.repository,
            worker_id=deps.worker_id,
            job_id=job_id,
            failure=delivery.failure,
        )
    if should_dead_letter:
        try:
            deps.consumer.dead_letter(
                delivery.delivery_tag,
                delivery.raw_fields,
                failure=delivery.failure,
                deliveries=delivery.deliveries,
            )
        except Exception:
            logger.exception(
                "Failed to dead-letter OCR queue delivery; leaving pending",
                extra={
                    "job_id": job_id,
                    "delivery_tag": delivery.delivery_tag,
                    "failure_code": delivery.failure.code.value,
                },
            )
    else:
        logger.error(
            "Max-attempt OCR delivery could not be persisted as failed; leaving pending",
            extra={"job_id": job_id, "delivery_tag": delivery.delivery_tag},
        )
    return JobRunOutcome(
        pulled=True,
        job_id=job_id,
        status=OcrJobStatus.FAILED,
        duration_ms=0.0,
    )
