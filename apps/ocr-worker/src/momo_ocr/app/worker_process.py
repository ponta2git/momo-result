"""Worker process main loop.

Each loop slot pulls one OCR job at a time, runs it, and either pulls again
immediately if a delivery was processed or sleeps briefly to avoid busy
waiting. The shutdown event is the only termination signal: slots finish
their in-flight jobs before exiting.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, replace

from momo_ocr.features.ocr_jobs.dependencies import JobRunnerDependencies
from momo_ocr.features.ocr_jobs.runner import run_one_job

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkerLoopConfig:
    idle_sleep_seconds: float = 1.0
    concurrency: int = 1

    def __post_init__(self) -> None:
        if self.idle_sleep_seconds <= 0:
            msg = "idle_sleep_seconds must be a positive number."
            raise ValueError(msg)
        if self.concurrency < 1:
            msg = "concurrency must be a positive integer."
            raise ValueError(msg)


def run_worker_process(
    deps: JobRunnerDependencies,
    *,
    shutdown_event: threading.Event,
    config: WorkerLoopConfig | None = None,
) -> None:
    cfg = config or WorkerLoopConfig()
    if cfg.concurrency == 1:
        _run_worker_loop(deps, shutdown_event=shutdown_event, config=cfg)
        return

    logger.info(
        "OCR worker process starting",
        extra={"worker_id": deps.worker_id, "concurrency": cfg.concurrency},
    )
    threads = [
        threading.Thread(
            target=_run_worker_loop,
            name=f"momo-ocr-worker-{slot}",
            kwargs={
                "deps": replace(deps, worker_id=f"{deps.worker_id}-{slot}"),
                "shutdown_event": shutdown_event,
                "config": cfg,
            },
        )
        for slot in range(1, cfg.concurrency + 1)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    logger.info(
        "OCR worker process exiting",
        extra={"worker_id": deps.worker_id, "concurrency": cfg.concurrency},
    )


def _run_worker_loop(
    deps: JobRunnerDependencies,
    *,
    shutdown_event: threading.Event,
    config: WorkerLoopConfig,
) -> None:
    logger.info("OCR worker loop starting", extra={"worker_id": deps.worker_id})
    while not shutdown_event.is_set():
        try:
            outcome = run_one_job(deps)
        except Exception:
            logger.exception(
                "OCR worker loop iteration failed; backing off before retry",
                extra={"worker_id": deps.worker_id},
            )
            shutdown_event.wait(config.idle_sleep_seconds)
            continue
        if not outcome.pulled:
            shutdown_event.wait(config.idle_sleep_seconds)
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
