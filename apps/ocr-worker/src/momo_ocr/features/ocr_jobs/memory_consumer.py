from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from threading import Lock

from momo_ocr.features.ocr_jobs.models import (
    MalformedPulledJob,
    OcrQueueDelivery,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message
from momo_ocr.shared.errors import OcrError, OcrFailure


@dataclass
class _FakeDelivery:
    payload: Mapping[str, str]
    delivery_tag: str


class InMemoryOcrJobConsumer:
    """Test double implementing the OCR job consumer contract."""

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
