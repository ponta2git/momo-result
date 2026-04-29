from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from threading import Lock
from typing import Protocol

from momo_ocr.features.ocr_jobs.models import PulledJob
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message


class OcrJobConsumer(Protocol):
    """Pull-based consumer of OCR job deliveries.

    Implementations wrap a transport (e.g. Redis Streams XREADGROUP). The
    contract is intentionally minimal so that the runner can be exercised with
    an in-memory fake during tests.
    """

    def pull(self) -> PulledJob | None:
        """Return the next available delivery, or ``None`` if nothing is ready.

        Implementations may block up to a transport-specific budget. They must
        not block indefinitely: the runner relies on returning to its loop to
        observe shutdown signals.
        """
        raise NotImplementedError

    def ack(self, delivery_tag: str) -> None:
        """Mark the delivery as successfully processed.

        Must only be called after a terminal job status has been durably
        persisted to the source-of-truth DB. If the consumer is unable to
        acknowledge, it should raise rather than silently swallow the failure.
        """
        raise NotImplementedError

    def nack(self, delivery_tag: str) -> None:
        """Release the delivery back to the queue for redelivery.

        Used when processing failed in a way the runner deems retryable and
        the worker is the wrong place to mutate attempt counts.
        """
        raise NotImplementedError


@dataclass
class _FakeDelivery:
    payload: Mapping[str, str]
    delivery_tag: str


class InMemoryOcrJobConsumer:
    """Test double implementing :class:`OcrJobConsumer`.

    Deliveries are queued by tests via :meth:`enqueue` and pulled in FIFO
    order. ``ack``/``nack`` calls are recorded on the instance so that tests
    can assert the exact sequence of acknowledgements without needing to
    inspect a real broker.
    """

    def __init__(self) -> None:
        self._deliveries: deque[_FakeDelivery] = deque()
        self._lock = Lock()
        self.acked: list[str] = []
        self.nacked: list[str] = []

    def enqueue(self, payload: Mapping[str, str], *, delivery_tag: str) -> None:
        with self._lock:
            self._deliveries.append(_FakeDelivery(payload=dict(payload), delivery_tag=delivery_tag))

    def pull(self) -> PulledJob | None:
        with self._lock:
            if not self._deliveries:
                return None
            delivery = self._deliveries.popleft()
        message = parse_job_message(delivery.payload)
        return PulledJob(message=message, delivery_tag=delivery.delivery_tag)

    def ack(self, delivery_tag: str) -> None:
        self.acked.append(delivery_tag)

    def nack(self, delivery_tag: str) -> None:
        self.nacked.append(delivery_tag)

    def pending(self) -> int:
        with self._lock:
            return len(self._deliveries)
