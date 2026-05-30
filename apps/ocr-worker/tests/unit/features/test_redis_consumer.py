from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

import pytest
from redis.typing import EncodableT, KeyT

from momo_ocr.features.ocr_jobs.consumer import (
    DEFAULT_REDIS_RETRY_CONFIG,
    RedisConsumerRetryConfig,
    RedisOcrJobConsumer,
    RedisStreamId,
)
from momo_ocr.features.ocr_jobs.models import (
    MalformedPulledJob,
    MaxAttemptsExceededPulledJob,
    PulledJob,
)
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure


class FakeRedis:
    def __init__(
        self,
        deliveries: object,
        *,
        pending_entries: object | None = None,
        claimed: object | None = None,
    ) -> None:
        self.deliveries = deliveries
        self.pending_entries = [] if pending_entries is None else pending_entries
        self.claimed = [] if claimed is None else claimed
        self.acked: list[tuple[str, str, str]] = []
        self.dead_letters: list[tuple[str, dict[str, str]]] = []
        self.pipeline_transactions: list[bool] = []
        self.pipeline_commands: list[tuple[str, ...]] = []
        self.group_created = False
        self.pending_range_counts: list[int] = []
        self.claimed_message_ids: list[list[str]] = []
        self.claim_idle_ms: list[int] = []
        self.blocks: list[int] = []
        self.closed = False

    def xgroup_create(
        self,
        _name: KeyT,
        _groupname: KeyT,
        _stream_id: RedisStreamId,
        /,
        *,
        mkstream: bool,
    ) -> None:
        self.group_created = True
        assert mkstream is True

    def xreadgroup(
        self,
        _groupname: str,
        _consumername: str,
        _streams: dict[KeyT, RedisStreamId],
        /,
        *,
        count: int,
        block: int,
    ) -> object:
        assert count == 1
        assert block > 0
        self.blocks.append(block)
        return self.deliveries

    def xpending_range(
        self,
        _name: KeyT,
        _groupname: KeyT,
        _min_id: RedisStreamId,
        _max_id: RedisStreamId,
        /,
        *,
        count: int,
    ) -> object:
        self.pending_range_counts.append(count)
        return self.pending_entries

    def xclaim(
        self,
        _name: KeyT,
        _groupname: KeyT,
        _consumername: KeyT,
        /,
        *,
        min_idle_time: int,
        message_ids: list[RedisStreamId] | tuple[RedisStreamId],
    ) -> object:
        self.claim_idle_ms.append(min_idle_time)
        self.claimed_message_ids.append([str(message_id) for message_id in message_ids])
        return self.claimed

    def xadd(self, stream: KeyT, fields: dict[EncodableT, EncodableT], /) -> str:
        self.dead_letters.append(
            (str(stream), {str(key): str(value) for key, value in fields.items()})
        )
        return "dead-1"

    def xack(self, stream: KeyT, group: KeyT, delivery_tag: RedisStreamId, /) -> None:
        self.acked.append((str(stream), str(group), str(delivery_tag)))

    def pipeline(
        self,
        transaction: object | None = None,
        shard_hint: object | None = None,
    ) -> FakeRedisPipeline:
        del shard_hint
        self.pipeline_transactions.append(True if transaction is None else bool(transaction))
        return FakeRedisPipeline(self)

    def close(self) -> None:
        self.closed = True


class FakeRedisPipeline:
    def __init__(self, redis: FakeRedis) -> None:
        self._redis = redis
        self._commands: list[Callable[[], object]] = []

    def xadd(self, stream: KeyT, fields: dict[EncodableT, EncodableT], /) -> FakeRedisPipeline:
        self._redis.pipeline_commands.append(("xadd", str(stream)))
        self._commands.append(lambda: self._redis.xadd(stream, fields))
        return self

    def xack(
        self,
        stream: KeyT,
        group: KeyT,
        delivery_tag: RedisStreamId,
        /,
    ) -> FakeRedisPipeline:
        self._redis.pipeline_commands.append(("xack", str(stream), str(group), str(delivery_tag)))
        self._commands.append(lambda: self._redis.xack(stream, group, delivery_tag))
        return self

    def execute(self) -> list[object]:
        return [command() for command in self._commands]


class RedisConsumerFactory(Protocol):
    def __call__(
        self,
        redis: FakeRedis,
        *,
        retry_config: RedisConsumerRetryConfig = DEFAULT_REDIS_RETRY_CONFIG,
    ) -> RedisOcrJobConsumer:
        raise NotImplementedError


@pytest.fixture
def valid_stream_payload() -> dict[str, str]:
    return {
        "schemaVersion": "1",
        "jobId": "job-1",
        "draftId": "draft-1",
        "imageId": "image-1",
        "imagePath": "/tmp/sample.jpg",
        "requestedScreenType": "total_assets",
        "attempt": "1",
        "enqueuedAt": "2026-04-29T10:00:00Z",
    }


@pytest.fixture
def redis_consumer_factory() -> RedisConsumerFactory:
    def make(
        redis: FakeRedis,
        *,
        retry_config: RedisConsumerRetryConfig = DEFAULT_REDIS_RETRY_CONFIG,
    ) -> RedisOcrJobConsumer:
        return RedisOcrJobConsumer(
            redis,
            stream="momo:ocr:jobs",
            group="momo-ocr-workers",
            consumer_name="worker-1",
            retry_config=retry_config,
        )

    return make


def test_redis_consumer_pulls_and_parses_valid_delivery(
    valid_stream_payload: dict[str, str],
    redis_consumer_factory: RedisConsumerFactory,
) -> None:
    redis = FakeRedis(
        [
            (
                "momo:ocr:jobs",
                [("1-0", valid_stream_payload)],
            )
        ]
    )
    consumer = redis_consumer_factory(redis)

    pulled = consumer.pull()

    assert redis.group_created is True
    assert pulled is not None
    assert isinstance(pulled, PulledJob)
    assert pulled.delivery_tag == "1-0"
    assert pulled.message.job_id == "job-1"


def test_redis_consumer_uses_configured_block_ms(
    valid_stream_payload: dict[str, str],
) -> None:
    redis = FakeRedis([("momo:ocr:jobs", [("1-0", valid_stream_payload)])])
    consumer = RedisOcrJobConsumer(
        redis,
        stream="momo:ocr:jobs",
        group="momo-ocr-workers",
        consumer_name="worker-1",
        block_ms=30_000,
    )

    pulled = consumer.pull()

    assert isinstance(pulled, PulledJob)
    assert redis.blocks == [30_000]


def test_redis_consumer_returns_malformed_delivery_for_runner_to_persist(
    redis_consumer_factory: RedisConsumerFactory,
) -> None:
    redis = FakeRedis([("momo:ocr:jobs", [("1-0", {"jobId": "job-1"})])])
    consumer = redis_consumer_factory(redis)

    pulled = consumer.pull()

    assert isinstance(pulled, MalformedPulledJob)
    assert pulled.raw_fields["jobId"] == "job-1"
    assert redis.acked == []


def test_redis_consumer_returns_max_attempts_delivery_for_runner_to_dead_letter(
    redis_consumer_factory: RedisConsumerFactory,
) -> None:
    redis = FakeRedis(
        [],
        pending_entries=[
            {
                "message_id": "1-0",
                "time_since_delivered": 30_000,
                "times_delivered": 1,
            }
        ],
        claimed=[("1-0", {"jobId": "job-1"})],
    )
    consumer = redis_consumer_factory(
        redis,
        retry_config=RedisConsumerRetryConfig(
            max_attempts=1,
            dead_letter_stream="momo:ocr:jobs:dead",
            claim_idle_ms=30_000,
            pending_scan_count=10,
        ),
    )

    pulled = consumer.pull()

    assert isinstance(pulled, MaxAttemptsExceededPulledJob)
    assert pulled.delivery_tag == "1-0"
    assert pulled.raw_fields == {"jobId": "job-1"}
    assert pulled.failure.code.value == "QUEUE_FAILURE"
    assert pulled.deliveries == 1
    assert redis.dead_letters == []
    assert redis.acked == []


def test_redis_consumer_dead_letters_and_acks_max_attempts_delivery(
    redis_consumer_factory: RedisConsumerFactory,
) -> None:
    redis = FakeRedis([])
    consumer = redis_consumer_factory(
        redis,
        retry_config=RedisConsumerRetryConfig(
            max_attempts=1,
            dead_letter_stream="momo:ocr:jobs:dead",
            claim_idle_ms=30_000,
            pending_scan_count=10,
        ),
    )

    consumer.dead_letter(
        "1-0",
        {"jobId": "job-1"},
        failure=OcrFailure(
            code=FailureCode.QUEUE_FAILURE,
            message="OCR queue delivery exceeded max attempts.",
        ),
        deliveries=1,
    )

    assert redis.dead_letters[0][0] == "momo:ocr:jobs:dead"
    assert redis.dead_letters[0][1]["deadLetterReason"] == "QUEUE_FAILURE"
    assert redis.acked == [("momo:ocr:jobs", "momo-ocr-workers", "1-0")]
    assert redis.pipeline_transactions == [True]
    assert redis.pipeline_commands == [
        ("xadd", "momo:ocr:jobs:dead"),
        ("xack", "momo:ocr:jobs", "momo-ocr-workers", "1-0"),
    ]


def test_redis_consumer_dead_letter_without_dlq_raises_without_ack(
    redis_consumer_factory: RedisConsumerFactory,
) -> None:
    redis = FakeRedis([])
    consumer = redis_consumer_factory(
        redis,
        retry_config=RedisConsumerRetryConfig(
            max_attempts=1,
            dead_letter_stream=None,
            claim_idle_ms=30_000,
            pending_scan_count=10,
        ),
    )

    with pytest.raises(OcrError):
        consumer.dead_letter(
            "1-0",
            {"jobId": "job-1"},
            failure=OcrFailure(
                code=FailureCode.QUEUE_FAILURE,
                message="OCR queue delivery exceeded max attempts.",
            ),
            deliveries=1,
        )

    assert redis.dead_letters == []
    assert redis.acked == []


def test_redis_consumer_scans_pending_entries_until_stale_delivery(
    valid_stream_payload: dict[str, str],
    redis_consumer_factory: RedisConsumerFactory,
) -> None:
    stale_delivery_payload = {
        **valid_stream_payload,
        "jobId": "job-2",
        "draftId": "draft-2",
        "imageId": "image-2",
    }
    redis = FakeRedis(
        [],
        pending_entries=[
            {
                "message_id": "1-0",
                "time_since_delivered": 1_000,
                "times_delivered": 1,
            },
            {
                "message_id": "2-0",
                "time_since_delivered": 30_000,
                "times_delivered": 1,
            },
        ],
        claimed=[("2-0", stale_delivery_payload)],
    )
    consumer = redis_consumer_factory(
        redis,
        retry_config=RedisConsumerRetryConfig(
            max_attempts=2,
            dead_letter_stream="momo:ocr:jobs:dead",
            claim_idle_ms=30_000,
            pending_scan_count=2,
        ),
    )

    pulled = consumer.pull()

    assert redis.pending_range_counts == [2]
    assert redis.claim_idle_ms == [30_000]
    assert redis.claimed_message_ids == [["2-0"]]
    assert isinstance(pulled, PulledJob)
    assert pulled.delivery_tag == "2-0"
    assert pulled.message.job_id == "job-2"
