from __future__ import annotations

from dataclasses import dataclass, field, replace
from threading import Lock
from typing import Protocol

from momo_ocr.features.ocr_jobs.lifecycle import ensure_transition_allowed
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobRecord,
    OcrJobStatus,
)
from momo_ocr.shared.errors import FailureCode, OcrError


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


@dataclass
class InMemoryOcrJobRepository:
    """Test double implementing :class:`OcrJobRepository`.

    Tracks the canonical status, attempt count, worker ownership, and the
    latest execution result for each job in process memory. The helper
    :meth:`seed` lets tests insert rows in arbitrary starting states.
    """

    records: dict[str, OcrJobRecord] = field(default_factory=dict)
    completions: dict[str, OcrJobExecutionResult] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)

    def seed(self, record: OcrJobRecord) -> None:
        with self._lock:
            self.records[record.job_id] = record

    def get_for_update(self, job_id: str) -> OcrJobRecord | None:
        with self._lock:
            return self.records.get(job_id)

    def transition_to_running(self, job_id: str, *, worker_id: str) -> None:
        with self._lock:
            current = self.records.get(job_id)
            if current is None:
                raise OcrError(
                    FailureCode.DB_WRITE_FAILED,
                    f"OCR job {job_id} is not present; cannot transition to running.",
                )
            ensure_transition_allowed(current.status, OcrJobStatus.RUNNING)
            self.records[job_id] = replace(
                current,
                status=OcrJobStatus.RUNNING,
                worker_id=worker_id,
                attempt_count=current.attempt_count + 1,
            )

    def complete(self, job_id: str, result: OcrJobExecutionResult) -> None:
        self._terminal_transition(job_id, result, expected=OcrJobStatus.SUCCEEDED)

    def transition_to_failed_terminal(self, job_id: str, result: OcrJobExecutionResult) -> None:
        if result.status not in {OcrJobStatus.FAILED, OcrJobStatus.CANCELLED}:
            raise OcrError(
                FailureCode.DB_WRITE_FAILED,
                f"Failed-terminal transition received non-failure status: {result.status.value}.",
            )
        self._terminal_transition(job_id, result, expected=result.status)

    def get_status(self, job_id: str) -> OcrJobStatus | None:
        with self._lock:
            current = self.records.get(job_id)
            return None if current is None else current.status

    def _terminal_transition(
        self,
        job_id: str,
        result: OcrJobExecutionResult,
        *,
        expected: OcrJobStatus,
    ) -> None:
        with self._lock:
            current = self.records.get(job_id)
            if current is None:
                raise OcrError(
                    FailureCode.DB_WRITE_FAILED,
                    f"OCR job {job_id} is not present; cannot complete.",
                )
            ensure_transition_allowed(current.status, expected)
            detected = (
                result.draft_payload.detected_screen_type
                if result.draft_payload is not None
                else current.detected_screen_type
            )
            self.records[job_id] = replace(
                current,
                status=expected,
                detected_screen_type=detected,
                failure=result.failure,
            )
            self.completions[job_id] = result
