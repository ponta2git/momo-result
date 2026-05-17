from __future__ import annotations

import threading

import pytest

from momo_ocr.app import worker_process as worker_process_module
from momo_ocr.app.worker_process import WorkerLoopConfig, run_worker_process
from momo_ocr.features.ocr_jobs.cancellation import InMemoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import InMemoryOcrJobConsumer
from momo_ocr.features.ocr_jobs.dependencies import JobRunnerDependencies
from momo_ocr.features.ocr_jobs.models import OcrJobStatus
from momo_ocr.features.ocr_jobs.repository import InMemoryOcrJobRepository
from momo_ocr.features.ocr_jobs.runner import JobRunOutcome


def _deps() -> JobRunnerDependencies:
    return JobRunnerDependencies(
        consumer=InMemoryOcrJobConsumer(),
        repository=InMemoryOcrJobRepository(),
        cancellation=InMemoryCancellationChecker(),
        worker_id="worker-test",
    )


def test_worker_loop_retries_after_iteration_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shutdown_event = threading.Event()
    calls = 0

    def fake_run_one_job(_deps: JobRunnerDependencies) -> JobRunOutcome:
        nonlocal calls
        calls += 1
        if calls == 1:
            message = "redis unavailable"
            raise RuntimeError(message)
        shutdown_event.set()
        return JobRunOutcome(
            pulled=True,
            job_id="job-1",
            status=OcrJobStatus.FAILED,
            duration_ms=1.0,
        )

    monkeypatch.setattr(worker_process_module, "run_one_job", fake_run_one_job)

    run_worker_process(
        _deps(),
        shutdown_event=shutdown_event,
        config=WorkerLoopConfig(idle_sleep_seconds=0.001),
    )

    assert calls == 2


@pytest.mark.parametrize("value", [0.0, -1.0])
def test_worker_loop_config_rejects_non_positive_idle_sleep(value: float) -> None:
    with pytest.raises(ValueError, match="idle_sleep_seconds"):
        WorkerLoopConfig(idle_sleep_seconds=value)
