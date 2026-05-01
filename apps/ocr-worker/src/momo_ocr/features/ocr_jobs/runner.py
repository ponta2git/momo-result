"""OCR job runner.

Coordinates one OCR job from queue delivery to durable terminal status:

1. Pull a delivery from the consumer.
2. Look up the canonical job record and transition it to ``RUNNING``.
3. Check for cancellation before each expensive phase.
4. Run the OCR pipeline with hints projected from the queue message.
5. Persist the draft (on success) and the terminal job status, including
   failure metadata where applicable.
6. Delete the temporary image (best effort).
7. Acknowledge the delivery on the queue, *only* after the terminal status
   has been written. NACK on transient queue/repository failures so that
   the broker controls redelivery.

This module is wire-only: all transports and the OCR pipeline itself are
injected. See ``tests/unit/features/test_ocr_job_runner.py`` for the
integration shape.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning
from momo_ocr.features.ocr_jobs.cancellation import CancellationChecker
from momo_ocr.features.ocr_jobs.consumer import OcrJobConsumer
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobHints,
    OcrJobMessage,
    OcrJobStatus,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository
from momo_ocr.features.ocr_jobs.result_writer import OcrResultRecord, OcrResultWriter
from momo_ocr.features.ocr_results.ranked_rows import (
    DEFAULT_STATIC_ALIASES,
    PlayerAliasResolver,
    alias_resolver_from_map,
)
from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.report import AnalysisResult
from momo_ocr.features.temp_images.cleanup import delete_if_exists
from momo_ocr.features.text_recognition.engine import (
    FakeTextRecognitionEngine,
    TextRecognitionEngine,
)
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure

logger = logging.getLogger(__name__)


AnalyzeImageFn = Callable[..., AnalysisResult]


@dataclass(frozen=True)
class JobRunnerDependencies:
    """Wiring for :func:`run_one_job`.

    All transports are injected so the runner can be exercised against
    in-memory fakes in tests and against real Redis/Postgres adapters in
    production. The ``analyze`` callable defaults to the real OCR pipeline
    but is overridable for fast unit tests.

    ``text_engine`` is the long-lived OCR engine instance. Wiring a single
    engine into the runner ensures we do not pay engine-construction or
    PATH-resolution costs per job. The default ``FakeTextRecognitionEngine``
    keeps unit tests that override ``analyze`` with a no-op friendly to
    construct without standing up Tesseract.
    """

    consumer: OcrJobConsumer
    repository: OcrJobRepository
    result_writer: OcrResultWriter
    cancellation: CancellationChecker
    worker_id: str
    analyze: AnalyzeImageFn = analyze_image
    delete_image: Callable[[Path], bool] = delete_if_exists
    text_engine: TextRecognitionEngine = field(default_factory=FakeTextRecognitionEngine)


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
    Any unhandled exception in the pipeline is converted into a terminal
    ``FAILED`` job; the queue is acked so the broker does not redeliver
    indefinitely (retries are owned by the API/orchestrator).
    """
    delivery = deps.consumer.pull()
    if delivery is None:
        return JobRunOutcome(pulled=False, job_id=None, status=None, duration_ms=0.0)

    job_id = delivery.message.job_id
    started = time.monotonic()
    try:
        outcome_status = _process_delivery(deps, delivery)
    except OcrError as exc:
        _record_terminal_failure(deps, delivery.message, exc.to_failure())
        outcome_status = OcrJobStatus.FAILED
    except Exception as exc:
        logger.exception("Unhandled error in OCR job runner", extra={"job_id": job_id})
        failure = OcrFailure(
            code=FailureCode.PARSER_FAILED,
            message=f"Unexpected runner error: {type(exc).__name__}: {exc}",
            retryable=False,
        )
        _record_terminal_failure(deps, delivery.message, failure)
        outcome_status = OcrJobStatus.FAILED
    finally:
        # Best-effort image cleanup for every terminal outcome. Image
        # retention violates AGENTS.md; a delete failure is non-fatal.
        deps.delete_image(delivery.message.image_path)

    _ack_delivery(deps, delivery)
    duration_ms = (time.monotonic() - started) * 1000.0
    return JobRunOutcome(
        pulled=True,
        job_id=job_id,
        status=outcome_status,
        duration_ms=duration_ms,
    )


def _process_delivery(deps: JobRunnerDependencies, delivery: PulledJob) -> OcrJobStatus:  # noqa: PLR0911
    message = delivery.message

    record = deps.repository.get_for_update(message.job_id)
    if record is None:
        # The DB is the source of truth; an unknown job_id means the job was
        # never persisted (or was hard-deleted). We still ack the delivery so
        # the broker does not redeliver. No row to update.
        logger.warning(
            "OCR queue message references unknown job; dropping delivery",
            extra={"job_id": message.job_id, "delivery_tag": delivery.delivery_tag},
        )
        return OcrJobStatus.FAILED

    if record.status is OcrJobStatus.CANCELLED:
        # Cancelled before pickup — nothing to do. Ack so the broker drops it.
        return OcrJobStatus.CANCELLED

    if deps.cancellation.is_cancelled(message.job_id):
        deps.repository.transition_to_failed_terminal(
            message.job_id,
            OcrJobExecutionResult(
                status=OcrJobStatus.CANCELLED,
                draft_payload=None,
                failure=None,
                warnings=[],
                duration_ms=0.0,
            ),
        )
        return OcrJobStatus.CANCELLED

    deps.repository.transition_to_running(message.job_id, worker_id=deps.worker_id)

    # Mid-run cancellation check: API may have set CANCELLED concurrently
    # while we were transitioning. Honour it before doing any OCR work.
    if deps.cancellation.is_cancelled(message.job_id):
        deps.repository.transition_to_failed_terminal(
            message.job_id,
            OcrJobExecutionResult(
                status=OcrJobStatus.CANCELLED,
                draft_payload=None,
                failure=None,
                warnings=[],
                duration_ms=0.0,
            ),
        )
        return OcrJobStatus.CANCELLED

    started = time.monotonic()
    # DEBUG: MOMO_OCR_DEBUG_DIR が設定されていればジョブ別に ROI/前処理画像を吐く。
    # 環境変数を外せば完全に無効化される opt-in モード。
    debug_dir = _resolve_debug_dir(message.job_id, message.image_path)
    analysis = deps.analyze(
        image_path=message.image_path,
        requested_screen_type=message.requested_screen_type.value,
        debug_dir=debug_dir,
        include_raw_text=False,
        text_engine=deps.text_engine,
        layout_family_hint=message.hints.layout_family,
        alias_resolver=_alias_resolver_from_hints(message.hints),
    )
    duration_ms = (time.monotonic() - started) * 1000.0

    if analysis.failure_code is not None:
        failure = OcrFailure(
            code=FailureCode(analysis.failure_code),
            message=analysis.failure_message or "OCR pipeline reported failure.",
            retryable=analysis.failure_retryable,
            user_action=analysis.failure_user_action,
        )
        result = OcrJobExecutionResult(
            status=OcrJobStatus.FAILED,
            draft_payload=None,
            failure=failure,
            warnings=list(analysis.warnings),
            duration_ms=duration_ms,
        )
        deps.repository.transition_to_failed_terminal(message.job_id, result)
        return OcrJobStatus.FAILED

    if analysis.result is None:
        # Detection succeeded only as far as identifying that the image is
        # not parseable (e.g. screen type undetected). Surface as a FAILED
        # terminal status with the warnings preserved.
        failure = OcrFailure(
            code=FailureCode.CATEGORY_UNDETECTED,
            message="Screen type could not be classified; no draft was produced.",
            retryable=False,
            user_action="Re-upload a clearer screenshot or fill in the result manually.",
        )
        result = OcrJobExecutionResult(
            status=OcrJobStatus.FAILED,
            draft_payload=None,
            failure=failure,
            warnings=list(analysis.warnings),
            duration_ms=duration_ms,
        )
        deps.repository.transition_to_failed_terminal(message.job_id, result)
        return OcrJobStatus.FAILED

    payload = _attach_warnings(analysis.result, analysis.warnings)
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


def _resolve_debug_dir(job_id: object, image_path: Path) -> Path | None:
    """Return a per-job debug directory when MOMO_OCR_DEBUG_DIR is set.

    DEBUG: opt-in。環境変数が未設定/空なら `None` を返し、本番パイプラインに
    一切の副作用を与えない。設定時は ``<base>/<image_stem>__<job_id>/`` を返し、
    ファイル名から該当画像のディレクトリを特定しやすくする。
    """

    base = os.environ.get("MOMO_OCR_DEBUG_DIR", "").strip()
    if not base:
        return None
    safe_id = _sanitize_debug_segment(str(job_id))
    safe_stem = _sanitize_debug_segment(image_path.stem) or "image"
    debug_dir = Path(base).expanduser() / f"{safe_stem}__{safe_id}"
    try:
        debug_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.warning("Failed to create MOMO_OCR_DEBUG_DIR=%s; disabling debug dump", debug_dir)
        return None
    return debug_dir


def _sanitize_debug_segment(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value)


def _alias_resolver_from_hints(hints: OcrJobHints) -> PlayerAliasResolver:
    aliases: dict[str, tuple[str, ...]] = {
        canonical: tuple(values) for canonical, values in DEFAULT_STATIC_ALIASES.items()
    }
    for hint in hints.known_player_aliases:
        existing = aliases.get(hint.member_id, ())
        aliases[hint.member_id] = _dedupe_preserve_order((*existing, *hint.aliases))
    if hints.computer_player_aliases:
        existing_cpu = aliases.get("さくま社長", ())
        aliases["さくま社長"] = _dedupe_preserve_order(
            (*existing_cpu, *hints.computer_player_aliases)
        )
    return alias_resolver_from_map(aliases)


def _dedupe_preserve_order(items: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return tuple(out)


def _attach_warnings(payload: OcrDraftPayload, warnings: list[OcrWarning]) -> OcrDraftPayload:
    """Ensure the persisted payload carries the merged warning list."""
    if not warnings:
        return payload
    merged = list(payload.warnings)
    seen = {(w.code, w.message, w.field_path) for w in merged}
    for warning in warnings:
        key = (warning.code, warning.message, warning.field_path)
        if key in seen:
            continue
        merged.append(warning)
        seen.add(key)
    return OcrDraftPayload(
        requested_screen_type=payload.requested_screen_type,
        detected_screen_type=payload.detected_screen_type,
        profile_id=payload.profile_id,
        players=payload.players,
        category_payload=payload.category_payload,
        warnings=merged,
        raw_snippets=payload.raw_snippets,
    )


def _record_terminal_failure(
    deps: JobRunnerDependencies,
    message: OcrJobMessage,
    failure: OcrFailure,
) -> None:
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


def _ack_delivery(deps: JobRunnerDependencies, delivery: PulledJob) -> None:
    try:
        deps.consumer.ack(delivery.delivery_tag)
    except Exception:
        logger.exception(
            "Failed to acknowledge OCR queue delivery; broker will redeliver",
            extra={
                "job_id": delivery.message.job_id,
                "delivery_tag": delivery.delivery_tag,
            },
        )
