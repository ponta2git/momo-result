"""OCR job runner: top-level wire loop for a single delivery.

Responsibilities are kept to:

1. Pull a delivery from the consumer.
2. Drive :func:`pipeline.run_pipeline` (state-machine + analysis).
3. Convert any uncaught error into a terminal ``FAILED`` row via
   :func:`failure_recorder.record_terminal_failure`.
4. Best-effort delete the temporary image (image retention is forbidden
   by AGENTS.md).
5. Acknowledge the queue delivery *only* after the terminal status has
   been written.

State transitions, alias resolution, debug-dir resolution and warning
merging are factored into sibling modules. See those for details.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from momo_ocr.features.ocr_jobs.cancellation import CancellationChecker
from momo_ocr.features.ocr_jobs.consumer import OcrJobConsumer
from momo_ocr.features.ocr_jobs.delivery_handler import ack_delivery
from momo_ocr.features.ocr_jobs.failure_recorder import record_terminal_failure
from momo_ocr.features.ocr_jobs.models import OcrJobStatus
from momo_ocr.features.ocr_jobs.pipeline import run_pipeline
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository
from momo_ocr.features.ocr_jobs.result_writer import OcrResultWriter
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
    log_extra: dict[str, str] = {"job_id": job_id}
    if delivery.message.request_id:
        log_extra["request_id"] = delivery.message.request_id
    started = time.monotonic()
    try:
        outcome_status = run_pipeline(deps, delivery)
    except OcrError as exc:
        record_terminal_failure(deps, delivery.message, exc.to_failure())
        outcome_status = OcrJobStatus.FAILED
    except Exception as exc:
        logger.exception("Unhandled error in OCR job runner", extra=log_extra)
        failure = OcrFailure(
            code=FailureCode.PARSER_FAILED,
            message=f"Unexpected runner error: {type(exc).__name__}: {exc}",
            retryable=False,
        )
        record_terminal_failure(deps, delivery.message, failure)
        outcome_status = OcrJobStatus.FAILED
    finally:
        # Best-effort image cleanup for every terminal outcome. Image
        # retention violates AGENTS.md; a delete failure is non-fatal.
        deps.delete_image(delivery.message.image_path)

    ack_delivery(deps, delivery)
    duration_ms = (time.monotonic() - started) * 1000.0
    return JobRunOutcome(
        pulled=True,
        job_id=job_id,
        status=outcome_status,
        duration_ms=duration_ms,
    )
