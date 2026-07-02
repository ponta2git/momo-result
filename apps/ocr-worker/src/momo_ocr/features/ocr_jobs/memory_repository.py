from __future__ import annotations

from dataclasses import dataclass, field, replace
from threading import Lock

from momo_ocr.features.ocr_jobs.lifecycle import ensure_transition_allowed
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobRecord,
    OcrJobStatus,
)
from momo_ocr.features.ocr_jobs.repository_contract import (
    ensure_non_success_result,
    ensure_success_result,
    ensure_terminal_result,
)
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from momo_ocr.shared.errors import FailureCode, OcrError


@dataclass
class InMemoryOcrJobRepository:
    """Test double implementing the OCR job repository contract."""

    records: dict[str, OcrJobRecord] = field(default_factory=dict)
    completions: dict[str, OcrJobExecutionResult] = field(default_factory=dict)
    result_records: dict[str, OcrResultRecord] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)

    def seed(self, record: OcrJobRecord) -> None:
        with self._lock:
            self.records[record.job_id] = record

    def get_record(self, job_id: str) -> OcrJobRecord | None:
        with self._lock:
            return self.records.get(job_id)

    def claim_for_running(self, job_id: str, *, worker_id: str) -> OcrJobRecord | None:
        with self._lock:
            current = self.records.get(job_id)
            if current is None:
                return None
            if current.status is not OcrJobStatus.QUEUED:
                return current
            claimed = replace(
                current,
                status=OcrJobStatus.RUNNING,
                worker_id=worker_id,
                attempt_count=current.attempt_count + 1,
            )
            self.records[job_id] = claimed
            return claimed

    def complete_success(
        self,
        job_id: str,
        result_record: OcrResultRecord,
        result: OcrJobExecutionResult,
    ) -> None:
        ensure_success_result(result_record, result)
        self._terminal_transition(
            job_id,
            result,
            expected=OcrJobStatus.SUCCEEDED,
            result_record=result_record,
        )

    def complete_non_success(self, job_id: str, result: OcrJobExecutionResult) -> None:
        ensure_non_success_result(result)
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
        result_record: OcrResultRecord | None = None,
    ) -> None:
        ensure_terminal_result(result, expected)
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
            if result_record is not None:
                self.result_records[result_record.job_id] = result_record
