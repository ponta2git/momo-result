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
from pathlib import Path
from typing import Protocol

from momo_ocr.features.ocr_analysis.report import AnalysisResult
from momo_ocr.features.ocr_jobs.aliases import alias_resolver_from_hints
from momo_ocr.features.ocr_jobs.cancellation import CancellationChecker
from momo_ocr.features.ocr_jobs.debug_dir import resolve_debug_dir
from momo_ocr.features.ocr_jobs.dependencies import AnalyzeImageFn
from momo_ocr.features.ocr_jobs.lifecycle import is_terminal
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobMessage,
    OcrJobRecord,
    OcrJobStatus,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from momo_ocr.features.ocr_results.payload_warnings import attach_warnings_to_payload
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure

logger = logging.getLogger(__name__)


class PipelineDependencies(Protocol):
    @property
    def repository(self) -> OcrJobRepository:
        raise NotImplementedError

    @property
    def cancellation(self) -> CancellationChecker:
        raise NotImplementedError

    @property
    def worker_id(self) -> str:
        raise NotImplementedError

    @property
    def analyze(self) -> AnalyzeImageFn:
        raise NotImplementedError

    @property
    def text_engine(self) -> TextRecognitionEngine:
        raise NotImplementedError

    @property
    def temp_root(self) -> Path | None:
        raise NotImplementedError

    @property
    def fast_path_enabled(self) -> bool:
        raise NotImplementedError

    @property
    def debug_dir_base(self) -> Path | None:
        raise NotImplementedError


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

    return _phase_execute(deps, message)


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
        deps.repository.complete_non_success(message.job_id, _cancelled_result())
    except OcrError as exc:
        if exc.code is not FailureCode.DB_WRITE_FAILED:
            raise
        refreshed = deps.repository.get_record(message.job_id)
        if refreshed is not None and is_terminal(refreshed.status):
            return refreshed.status
        raise
    return OcrJobStatus.CANCELLED


def _phase_execute(deps: PipelineDependencies, message: OcrJobMessage) -> OcrJobStatus:
    started = time.monotonic()
    debug_dir = resolve_debug_dir(
        message.job_id,
        message.image_path,
        base_dir=deps.debug_dir_base,
    )
    analysis = deps.analyze(
        image_path=message.image_path,
        requested_screen_type=message.requested_screen_type.value,
        debug_dir=debug_dir,
        include_raw_text=False,
        text_engine=deps.text_engine,
        layout_family_hint=message.hints.layout_family,
        alias_resolver=alias_resolver_from_hints(message.hints),
        image_root=deps.temp_root,
        enforce_size_limit=True,
        fast_path_enabled=deps.fast_path_enabled,
    )
    duration_ms = (time.monotonic() - started) * 1000.0
    return _persist_analysis_result(deps, message, analysis, duration_ms)


def _persist_analysis_result(
    deps: PipelineDependencies,
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
        deps.repository.complete_non_success(
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
        deps.repository.complete_non_success(
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
    result_record = OcrResultRecord(
        job_id=message.job_id,
        draft_id=message.draft_id,
        payload=payload,
        warnings=tuple(payload.warnings),
        timings_ms=dict(analysis.timings_ms),
    )
    deps.repository.complete_success(
        message.job_id,
        result_record,
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
