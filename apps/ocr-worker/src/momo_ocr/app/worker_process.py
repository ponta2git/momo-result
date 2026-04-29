"""Worker process main loop.

The loop pulls one OCR job at a time, runs it, and either pulls again
immediately if a delivery was processed or sleeps briefly to avoid busy
waiting. The shutdown event is the only termination signal: the loop
finishes the in-flight job before exiting.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies, run_one_job

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkerLoopConfig:
    idle_sleep_seconds: float = 1.0


def run_worker_process(
    deps: JobRunnerDependencies,
    *,
    shutdown_event: threading.Event,
    config: WorkerLoopConfig | None = None,
) -> None:
    cfg = config or WorkerLoopConfig()
    logger.info("OCR worker loop starting", extra={"worker_id": deps.worker_id})
    while not shutdown_event.is_set():
        outcome = run_one_job(deps)
        if not outcome.pulled:
            shutdown_event.wait(cfg.idle_sleep_seconds)
            continue
        logger.info(
            "OCR job processed",
            extra={
                "worker_id": deps.worker_id,
                "job_id": outcome.job_id,
                "status": outcome.status.value if outcome.status is not None else None,
                "duration_ms": outcome.duration_ms,
            },
        )
    logger.info("OCR worker loop exiting", extra={"worker_id": deps.worker_id})
