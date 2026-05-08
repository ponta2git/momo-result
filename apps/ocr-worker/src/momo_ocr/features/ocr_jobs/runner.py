"""OCR job runner: top-level wire loop for a single delivery.

Responsibilities are kept to:

1. Pull a delivery from the consumer.
2. Drive :func:`pipeline.run_pipeline` (state-machine + analysis).
3. Convert any uncaught error into a terminal ``FAILED`` row via
   :func:`failure_recorder.record_terminal_failure`.
4. Acknowledge the queue delivery *only* after the terminal status has
   been written.

State transitions, alias resolution, debug-dir resolution and warning
merging are factored into sibling modules. See those for details.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from momo_ocr.features.ocr_jobs.cancellation import CancellationChecker
from momo_ocr.features.ocr_jobs.consumer import OcrJobConsumer
from momo_ocr.features.ocr_jobs.delivery_handler import ack_delivery
from momo_ocr.features.ocr_jobs.failure_recorder import record_terminal_failure
from momo_ocr.features.ocr_jobs.models import MalformedPulledJob, OcrJobStatus
from momo_ocr.features.ocr_jobs.pipeline import run_pipeline
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository
from momo_ocr.features.ocr_results.player_aliases import PlayerAliasResolver
from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.report import AnalysisResult
from momo_ocr.features.text_recognition.engine import (
    FakeTextRecognitionEngine,
    TextRecognitionEngine,
)
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure

logger = logging.getLogger(__name__)


class AnalyzeImageFn(Protocol):
    def __call__(  # noqa: PLR0913 - mirrors the analyzer boundary explicitly.
        self,
        *,
        image_path: Path,
        requested_screen_type: str,
        debug_dir: Path | None,
        include_raw_text: bool,
        text_engine: TextRecognitionEngine | None = None,
        layout_family_hint: str | None = None,
        alias_resolver: PlayerAliasResolver | None = None,
    ) -> AnalysisResult:
        raise NotImplementedError


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
    cancellation: CancellationChecker
    worker_id: str
    analyze: AnalyzeImageFn = analyze_image
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

    if isinstance(delivery, MalformedPulledJob):
        return _handle_malformed_delivery(deps, delivery)

    job_id = delivery.message.job_id
    log_extra: dict[str, str] = {"job_id": job_id}
    if delivery.message.request_id:
        log_extra["request_id"] = delivery.message.request_id
    started = time.monotonic()
    should_ack = True
    try:
        outcome_status = run_pipeline(deps, delivery)
    except OcrError as exc:
        should_ack = record_terminal_failure(deps, delivery.message.job_id, exc.to_failure())
        outcome_status = OcrJobStatus.FAILED
    except Exception:
        logger.exception("Unhandled error in OCR job runner", extra=log_extra)
        failure = OcrFailure(
            code=FailureCode.PARSER_FAILED,
            message="Unexpected OCR worker error.",
            retryable=False,
        )
        should_ack = record_terminal_failure(deps, delivery.message.job_id, failure)
        outcome_status = OcrJobStatus.FAILED
    if should_ack:
        ack_delivery(deps, delivery)
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


def _handle_malformed_delivery(
    deps: JobRunnerDependencies,
    delivery: MalformedPulledJob,
) -> JobRunOutcome:
    job_id = delivery.raw_fields.get("jobId")
    should_ack = True
    if job_id:
        should_ack = record_terminal_failure(deps, job_id, delivery.failure)
    if should_ack:
        ack_delivery(deps, delivery)
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
