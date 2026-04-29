from __future__ import annotations

from typing import Protocol

from momo_ocr.features.ocr_jobs.models import OcrJobExecutionResult, OcrJobRecord, OcrJobStatus


class OcrJobRepository(Protocol):
    def get_for_update(self, job_id: str) -> OcrJobRecord | None:
        raise NotImplementedError

    def transition_to_running(self, job_id: str, *, worker_id: str) -> None:
        raise NotImplementedError

    def complete(self, job_id: str, result: OcrJobExecutionResult) -> None:
        raise NotImplementedError

    def transition_to_failed_terminal(self, job_id: str, result: OcrJobExecutionResult) -> None:
        raise NotImplementedError

    def get_status(self, job_id: str) -> OcrJobStatus | None:
        raise NotImplementedError
