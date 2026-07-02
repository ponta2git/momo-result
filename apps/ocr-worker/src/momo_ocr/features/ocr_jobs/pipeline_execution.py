from __future__ import annotations

import time

from momo_ocr.features.ocr_analysis.report import AnalysisResult
from momo_ocr.features.ocr_jobs.aliases import alias_resolver_from_hints
from momo_ocr.features.ocr_jobs.debug_dir import resolve_debug_dir
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobMessage,
    OcrJobStatus,
)
from momo_ocr.features.ocr_jobs.pipeline_dependencies import PipelineDependencies
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from momo_ocr.features.result_projection.payload_warnings import attach_warnings_to_payload
from momo_ocr.shared.errors import FailureCode, OcrFailure


def execute_analysis_phase(deps: PipelineDependencies, message: OcrJobMessage) -> OcrJobStatus:
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


def cancelled_result() -> OcrJobExecutionResult:
    return OcrJobExecutionResult(
        status=OcrJobStatus.CANCELLED,
        draft_payload=None,
        failure=None,
        warnings=[],
        duration_ms=0.0,
    )


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
