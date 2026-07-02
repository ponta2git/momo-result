from __future__ import annotations

import logging
from collections.abc import Mapping
from threading import Lock
from typing import Any, cast

from redis.exceptions import ResponseError
from redis.typing import EncodableT, KeyT

from momo_ocr.features.ocr_jobs.models import (
    MalformedPulledJob,
    MaxAttemptsExceededPulledJob,
    OcrQueueDelivery,
    PulledJob,
)
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message
from momo_ocr.features.ocr_jobs.redis_retry import (
    DEFAULT_REDIS_RETRY_CONFIG,
    RedisConsumerRetryConfig,
)
from momo_ocr.features.ocr_jobs.redis_stream_types import (
    RedisPipeline,
    RedisStreamClient,
    RedisStreamId,
)
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure

logger = logging.getLogger(__name__)


class RedisOcrJobConsumer:
    """Redis Streams-backed OCR job consumer."""

    def __init__(
        self,
        redis_client: RedisStreamClient,
        *,
        stream: str,
        group: str,
        consumer_name: str,
        block_ms: int = 1000,
        retry_config: RedisConsumerRetryConfig = DEFAULT_REDIS_RETRY_CONFIG,
    ) -> None:
        self._redis = redis_client
        self._stream = stream
        self._group = group
        self._consumer_name = consumer_name
        self._block_ms = block_ms
        self._retry_config = retry_config
        self._pull_lock = Lock()
        self._ensure_group()

    def pull(self) -> OcrQueueDelivery | None:
        with self._pull_lock:
            return self._pull_unlocked()

    def _pull_unlocked(self) -> OcrQueueDelivery | None:
        pending = self._claim_pending_delivery()
        if pending is not None:
            return pending

        streams: dict[KeyT, RedisStreamId] = {self._stream: ">"}
        raw_deliveries = self._redis.xreadgroup(
            self._group,
            self._consumer_name,
            streams,
            count=1,
            block=self._block_ms,
        )
        if not raw_deliveries:
            return None

        message_id, fields = _first_stream_message(raw_deliveries)
        return self._delivery_from_fields(message_id, fields)

    def _delivery_from_fields(self, message_id: str, fields: dict[str, str]) -> OcrQueueDelivery:
        try:
            message = parse_job_message(fields)
        except OcrError as exc:
            return MalformedPulledJob(
                delivery_tag=message_id,
                raw_fields=fields,
                failure=exc.to_failure(),
            )
        return PulledJob(message=message, delivery_tag=message_id)

    def ack(self, delivery_tag: str) -> None:
        self._redis.xack(self._stream, self._group, delivery_tag)

    def close(self) -> None:
        self._redis.close()

    def _claim_pending_delivery(self) -> OcrQueueDelivery | None:
        entry = self._stale_pending_entry()
        if entry is None:
            return None

        message_id = str(entry["message_id"])
        deliveries = _int_from_mapping(entry, "times_delivered", default=1)
        claimed = self._claim_message(message_id)
        if not claimed:
            return None

        claimed_id, raw_fields = claimed[0]
        fields = {str(key): str(value) for key, value in raw_fields.items()}
        if deliveries >= self._retry_config.max_attempts:
            return MaxAttemptsExceededPulledJob(
                delivery_tag=str(claimed_id),
                raw_fields=fields,
                failure=_max_attempts_failure(),
                deliveries=deliveries,
            )
        return self._delivery_from_fields(str(claimed_id), fields)

    def _claim_message(self, message_id: str) -> list[tuple[str, dict[str, object]]]:
        message_ids: list[RedisStreamId] = [message_id]
        return cast(
            "list[tuple[str, dict[str, object]]]",
            self._redis.xclaim(
                self._stream,
                self._group,
                self._consumer_name,
                min_idle_time=self._retry_config.claim_idle_ms,
                message_ids=message_ids,
            ),
        )

    def _stale_pending_entry(self) -> dict[str, object] | None:
        pending_entries = cast(
            "list[dict[str, object]]",
            self._redis.xpending_range(
                self._stream,
                self._group,
                "-",
                "+",
                count=self._retry_config.pending_scan_count,
            ),
        )
        for entry in pending_entries:
            idle_ms = _int_from_mapping(entry, "time_since_delivered", default=0)
            if idle_ms >= self._retry_config.claim_idle_ms:
                return entry
        return None

    def dead_letter(
        self,
        delivery_tag: str,
        raw_fields: Mapping[str, str],
        *,
        failure: OcrFailure,
        deliveries: int,
    ) -> None:
        if self._retry_config.dead_letter_stream is None:
            logger.error(
                "OCR queue delivery exceeded max attempts and no DLQ is configured",
                extra={"delivery_tag": delivery_tag},
            )
            raise OcrError(
                FailureCode.QUEUE_FAILURE,
                "OCR queue delivery exceeded max attempts but no DLQ is configured.",
            )

        pipeline = cast("RedisPipeline", self._redis.pipeline(transaction=True))
        pipeline.xadd(
            self._retry_config.dead_letter_stream,
            _dead_letter_fields(raw_fields, failure=failure, deliveries=deliveries),
        )
        pipeline.xack(self._stream, self._group, delivery_tag)
        pipeline.execute()
        logger.error(
            "Moved OCR queue delivery to dead-letter stream",
            extra={
                "delivery_tag": delivery_tag,
                "failure_code": failure.code.value,
            },
        )

    def _ensure_group(self) -> None:
        try:
            self._redis.xgroup_create(
                self._stream,
                self._group,
                "0",
                mkstream=True,
            )
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise


def _dead_letter_fields(
    raw_fields: Mapping[str, str],
    *,
    failure: OcrFailure,
    deliveries: int,
) -> dict[EncodableT, EncodableT]:
    dlq_fields: dict[EncodableT, EncodableT] = {
        cast("EncodableT", key): cast("EncodableT", value) for key, value in raw_fields.items()
    }
    dlq_fields["deadLetterReason"] = failure.code.value
    dlq_fields["deadLetterMessage"] = failure.message
    dlq_fields["deadLetterDeliveries"] = str(deliveries)
    return dlq_fields


def _first_stream_message(raw_deliveries: object) -> tuple[str, dict[str, str]]:
    deliveries = cast("list[tuple[str, list[tuple[str, dict[str, Any]]]]]", raw_deliveries)
    _, messages = deliveries[0]
    message_id, raw_fields = messages[0]
    fields = {str(key): str(value) for key, value in raw_fields.items()}
    return message_id, fields


def _int_from_mapping(mapping: Mapping[str, object], key: str, *, default: int) -> int:
    value = mapping.get(key, default)
    if isinstance(value, int):
        return value
    if isinstance(value, str | bytes | bytearray):
        return int(value)
    if isinstance(value, float):
        return int(value)
    return default


def _max_attempts_failure() -> OcrFailure:
    return OcrFailure(
        code=FailureCode.QUEUE_FAILURE,
        message="OCR queue delivery exceeded max attempts.",
        retryable=False,
        user_action="運用に連絡してください",
    )
