from __future__ import annotations

import logging
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from threading import Lock
from typing import Any, Protocol, cast

from redis import Redis
from redis.exceptions import ResponseError

from momo_ocr.app.config import WorkerConfig
from momo_ocr.features.ocr_jobs.models import PulledJob
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message
from momo_ocr.shared.errors import OcrError

logger = logging.getLogger(__name__)


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


class RedisOcrJobConsumer:
    """Redis Streams-backed OCR job consumer.

    Invalid queue messages are acknowledged and dropped inside ``pull`` so the
    worker does not enter an infinite redelivery loop for malformed payloads.
    """

    def __init__(
        self,
        redis_client: Redis,
        *,
        stream: str,
        group: str,
        consumer_name: str,
        block_ms: int = 1000,
    ) -> None:
        self._redis = redis_client
        self._stream = stream
        self._group = group
        self._consumer_name = consumer_name
        self._block_ms = block_ms
        self._ensure_group()

    @classmethod
    def from_config(cls, config: WorkerConfig) -> RedisOcrJobConsumer:
        if config.redis_url is None:
            msg = "REDIS_URL is required to create RedisOcrJobConsumer."
            raise ValueError(msg)
        # health_check_interval forces redis-py to PING idle connections so
        # silently-dropped TCP sessions (Fly.io <-> Upstash NAT timeouts,
        # ~5min) surface as a fast reconnect instead of hanging the next
        # blocking XREADGROUP. socket_keepalive nudges the kernel to do the
        # same at the TCP layer; defaults to off otherwise. We deliberately
        # do not set socket_timeout: XREADGROUP block_ms (1s) is the upper
        # bound for any single call, so adding a socket-level timeout would
        # only fight with that loop.
        client = Redis.from_url(
            config.redis_url,
            decode_responses=True,
            health_check_interval=30,
            socket_keepalive=True,
        )
        return cls(
            client,
            stream=config.redis_stream,
            group=config.redis_group,
            consumer_name=config.worker_id,
        )

    def pull(self) -> PulledJob | None:
        raw_deliveries = self._redis.xreadgroup(
            groupname=self._group,
            consumername=self._consumer_name,
            streams={self._stream: ">"},
            count=1,
            block=self._block_ms,
        )
        if not raw_deliveries:
            return None

        message_id, fields = _first_stream_message(raw_deliveries)
        try:
            message = parse_job_message(fields)
        except OcrError:
            logger.exception(
                "Dropping malformed OCR queue message",
                extra={"delivery_tag": message_id},
            )
            self.ack(message_id)
            return None
        return PulledJob(message=message, delivery_tag=message_id)

    def ack(self, delivery_tag: str) -> None:
        self._redis.xack(self._stream, self._group, delivery_tag)

    def nack(self, delivery_tag: str) -> None:
        msg = (
            "Redis Streams does not support immediate nack; delivery "
            f"{delivery_tag} remains pending until it is claimed."
        )
        raise NotImplementedError(msg)

    def close(self) -> None:
        self._redis.close()

    def _ensure_group(self) -> None:
        try:
            self._redis.xgroup_create(
                name=self._stream,
                groupname=self._group,
                id="0",
                mkstream=True,
            )
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise


def _first_stream_message(raw_deliveries: object) -> tuple[str, dict[str, str]]:
    deliveries = cast("list[tuple[str, list[tuple[str, dict[str, Any]]]]]", raw_deliveries)
    _, messages = deliveries[0]
    message_id, raw_fields = messages[0]
    fields = {str(key): str(value) for key, value in raw_fields.items()}
    return message_id, fields
