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
import time
from typing import TYPE_CHECKING

from momo_ocr.features.ocr_jobs.aliases import alias_resolver_from_hints
from momo_ocr.features.ocr_jobs.debug_dir import resolve_debug_dir
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobMessage,
    OcrJobStatus,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.result_writer import OcrResultRecord
from momo_ocr.features.ocr_results.payload_warnings import attach_warnings_to_payload
from momo_ocr.features.standalone_analysis.report import AnalysisResult
from momo_ocr.shared.errors import FailureCode, OcrFailure

if TYPE_CHECKING:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies

logger = logging.getLogger(__name__)


def run_pipeline(deps: JobRunnerDependencies, delivery: PulledJob) -> OcrJobStatus:
    """Walk the per-delivery state machine and return the terminal status."""
    message = delivery.message

    status = _phase_lookup_record(deps, delivery)
    if status is not None:
        return status

    status = _phase_pre_run_cancellation(deps, message)
    if status is not None:
        return status

    deps.repository.transition_to_running(message.job_id, worker_id=deps.worker_id)

    status = _phase_post_running_cancellation(deps, message)
    if status is not None:
        return status

    return _phase_execute(deps, message)


def _phase_lookup_record(deps: JobRunnerDependencies, delivery: PulledJob) -> OcrJobStatus | None:
    """Look up the canonical job record; return a terminal status if not runnable."""
    message = delivery.message
    record = deps.repository.get_for_update(message.job_id)
    if record is None:
        # The DB is the source of truth; an unknown job_id means the job
        # was never persisted (or was hard-deleted). Ack the delivery so
        # the broker does not redeliver.
        logger.warning(
            "OCR queue message references unknown job; dropping delivery",
            extra={"job_id": message.job_id, "delivery_tag": delivery.delivery_tag},
        )
        return OcrJobStatus.FAILED

    if record.status is OcrJobStatus.CANCELLED:
        # Cancelled before pickup — nothing to do.
        return OcrJobStatus.CANCELLED
    return None


def _phase_pre_run_cancellation(
    deps: JobRunnerDependencies, message: OcrJobMessage
) -> OcrJobStatus | None:
    if not deps.cancellation.is_cancelled(message.job_id):
        return None
    deps.repository.transition_to_failed_terminal(message.job_id, _cancelled_result())
    return OcrJobStatus.CANCELLED


def _phase_post_running_cancellation(
    deps: JobRunnerDependencies, message: OcrJobMessage
) -> OcrJobStatus | None:
    """Honour cancellation that arrived between transition_to_running and OCR start."""
    if not deps.cancellation.is_cancelled(message.job_id):
        return None
    deps.repository.transition_to_failed_terminal(message.job_id, _cancelled_result())
    return OcrJobStatus.CANCELLED


def _phase_execute(deps: JobRunnerDependencies, message: OcrJobMessage) -> OcrJobStatus:
    started = time.monotonic()
    debug_dir = resolve_debug_dir(message.job_id, message.image_path)
    analysis = deps.analyze(
        image_path=message.image_path,
        requested_screen_type=message.requested_screen_type.value,
        debug_dir=debug_dir,
        include_raw_text=False,
        text_engine=deps.text_engine,
        layout_family_hint=message.hints.layout_family,
        alias_resolver=alias_resolver_from_hints(message.hints),
    )
    duration_ms = (time.monotonic() - started) * 1000.0
    return _persist_analysis_result(deps, message, analysis, duration_ms)


def _persist_analysis_result(
    deps: JobRunnerDependencies,
    message: OcrJobMessage,
    analysis: AnalysisResult,
    duration_ms: float,
) -> OcrJobStatus:
    if analysis.failure_code is not None:
        failure = OcrFailure(
            code=FailureCode(analysis.failure_code),
            message=analysis.failure_message or "OCR pipeline reported failure.",
            retryable=analysis.failure_retryable,
            user_action=analysis.failure_user_action,
        )
        deps.repository.transition_to_failed_terminal(
            message.job_id,
            OcrJobExecutionResult(
                status=OcrJobStatus.FAILED,
                draft_payload=None,
                failure=failure,
                warnings=list(analysis.warnings),
                duration_ms=duration_ms,
            ),
        )
        return OcrJobStatus.FAILED

    if analysis.result is None:
        # Detection succeeded only as far as identifying that the image is
        # not parseable (e.g. screen type undetected). Surface as FAILED
        # with the warnings preserved.
        failure = OcrFailure(
            code=FailureCode.CATEGORY_UNDETECTED,
            message="Screen type could not be classified; no draft was produced.",
            retryable=False,
            user_action="Re-upload a clearer screenshot or fill in the result manually.",
        )
        deps.repository.transition_to_failed_terminal(
            message.job_id,
            OcrJobExecutionResult(
                status=OcrJobStatus.FAILED,
                draft_payload=None,
                failure=failure,
                warnings=list(analysis.warnings),
                duration_ms=duration_ms,
            ),
        )
        return OcrJobStatus.FAILED

    payload = attach_warnings_to_payload(analysis.result, analysis.warnings)
    deps.result_writer.persist(
        OcrResultRecord(
            job_id=message.job_id,
            draft_id=message.draft_id,
            payload=payload,
            warnings=tuple(analysis.warnings),
            timings_ms=dict(analysis.timings_ms),
        )
    )
    deps.repository.complete(
        message.job_id,
        OcrJobExecutionResult(
            status=OcrJobStatus.SUCCEEDED,
            draft_payload=payload,
            failure=None,
            warnings=list(analysis.warnings),
            duration_ms=duration_ms,
        ),
    )
    return OcrJobStatus.SUCCEEDED


def _cancelled_result() -> OcrJobExecutionResult:
    return OcrJobExecutionResult(
        status=OcrJobStatus.CANCELLED,
        draft_payload=None,
        failure=None,
        warnings=[],
        duration_ms=0.0,
    )
