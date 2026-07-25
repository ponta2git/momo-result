from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from threading import Lock

from momo_ocr.features.ocr_jobs.lifecycle import ensure_transition_allowed
from momo_ocr.features.ocr_jobs.models import (
    MalformedPulledJob,
    OcrJobExecutionResult,
    OcrJobRecord,
    OcrJobStatus,
    OcrQueueDelivery,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message
from momo_ocr.features.ocr_jobs.repository_contract import (
    ensure_non_success_result,
    ensure_success_result,
    ensure_terminal_result,
)
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure


@dataclass
class _FakeDelivery:
    payload: Mapping[str, str]
    delivery_tag: str


class InMemoryOcrJobConsumer:
    def __init__(self) -> None:
        self._deliveries: deque[_FakeDelivery] = deque()
        self._lock = Lock()
        self.acked: list[str] = []
        self.dead_letters: list[tuple[str, Mapping[str, str], OcrFailure, int]] = []

    def enqueue(self, payload: Mapping[str, str], *, delivery_tag: str) -> None:
        with self._lock:
            self._deliveries.append(_FakeDelivery(payload=dict(payload), delivery_tag=delivery_tag))

    def pull(self) -> OcrQueueDelivery | None:
        with self._lock:
            if not self._deliveries:
                return None
            delivery = self._deliveries.popleft()
        try:
            message = parse_job_message(delivery.payload)
        except OcrError as exc:
            return MalformedPulledJob(
                delivery_tag=delivery.delivery_tag,
                raw_fields=dict(delivery.payload),
                failure=exc.to_failure(),
            )
        return PulledJob(message=message, delivery_tag=delivery.delivery_tag)

    def ack(self, delivery_tag: str) -> None:
        self.acked.append(delivery_tag)

    def dead_letter(
        self,
        delivery_tag: str,
        raw_fields: Mapping[str, str],
        *,
        failure: OcrFailure,
        deliveries: int,
    ) -> None:
        self.dead_letters.append((delivery_tag, dict(raw_fields), failure, deliveries))
        self.ack(delivery_tag)

    def pending(self) -> int:
        with self._lock:
            return len(self._deliveries)


@dataclass
class InMemoryOcrJobRepository:
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


@dataclass
class InMemoryCancellationChecker:
    cancelled_job_ids: set[str] = field(default_factory=set)
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)

    def cancel(self, job_id: str) -> None:
        with self._lock:
            self.cancelled_job_ids.add(job_id)

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self.cancelled_job_ids
