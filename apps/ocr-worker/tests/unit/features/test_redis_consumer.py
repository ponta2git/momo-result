from __future__ import annotations

from typing import cast

from redis import Redis

from momo_ocr.features.ocr_jobs.consumer import RedisConsumerRetryConfig, RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.models import MalformedPulledJob, PulledJob


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
        self.dead_letters: list[tuple[str, dict[object, object]]] = []
        self.group_created = False
        self.pending_range_counts: list[int] = []
        self.claimed_message_ids: list[list[str]] = []

    def xgroup_create(self, **_kwargs: object) -> None:
        self.group_created = True

    def xreadgroup(self, **_kwargs: object) -> object:
        return self.deliveries

    def xpending_range(self, *_args: object, **kwargs: object) -> object:
        self.pending_range_counts.append(cast("int", kwargs["count"]))
        return self.pending_entries

    def xclaim(self, *_args: object, **kwargs: object) -> object:
        self.claimed_message_ids.append(cast("list[str]", kwargs["message_ids"]))
        return self.claimed

    def xadd(self, stream: str, fields: dict[object, object]) -> str:
        self.dead_letters.append((stream, fields))
        return "dead-1"

    def xack(self, stream: str, group: str, delivery_tag: str) -> None:
        self.acked.append((stream, group, delivery_tag))


def test_redis_consumer_pulls_and_parses_valid_delivery() -> None:
    redis = FakeRedis(
        [
            (
                "momo:ocr:jobs",
                [
                    (
                        "1-0",
                        {
                            "schemaVersion": "1",
                            "jobId": "job-1",
                            "draftId": "draft-1",
                            "imageId": "image-1",
                            "imagePath": "/tmp/sample.jpg",
                            "requestedScreenType": "total_assets",
                            "attempt": "1",
                            "enqueuedAt": "2026-04-29T10:00:00Z",
                        },
                    )
                ],
            )
        ]
    )

    consumer = RedisOcrJobConsumer(
        cast("Redis", redis),
        stream="momo:ocr:jobs",
        group="momo-ocr-workers",
        consumer_name="worker-1",
    )

    pulled = consumer.pull()

    assert redis.group_created is True
    assert pulled is not None
    assert isinstance(pulled, PulledJob)
    assert pulled.delivery_tag == "1-0"
    assert pulled.message.job_id == "job-1"


def test_redis_consumer_returns_malformed_delivery_for_runner_to_persist() -> None:
    redis = FakeRedis([("momo:ocr:jobs", [("1-0", {"jobId": "job-1"})])])
    consumer = RedisOcrJobConsumer(
        cast("Redis", redis),
        stream="momo:ocr:jobs",
        group="momo-ocr-workers",
        consumer_name="worker-1",
    )

    pulled = consumer.pull()

    assert isinstance(pulled, MalformedPulledJob)
    assert pulled.raw_fields["jobId"] == "job-1"
    assert redis.acked == []


def test_redis_consumer_moves_stale_delivery_to_dead_letter_after_max_attempts() -> None:
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
    consumer = RedisOcrJobConsumer(
        cast("Redis", redis),
        stream="momo:ocr:jobs",
        group="momo-ocr-workers",
        consumer_name="worker-1",
        retry_config=RedisConsumerRetryConfig(
            max_attempts=1,
            dead_letter_stream="momo:ocr:jobs:dead",
            claim_idle_ms=30_000,
            pending_scan_count=10,
        ),
    )

    pulled = consumer.pull()

    assert pulled is None
    assert redis.dead_letters[0][0] == "momo:ocr:jobs:dead"
    assert redis.dead_letters[0][1]["deadLetterReason"] == "QUEUE_FAILURE"
    assert redis.acked == [("momo:ocr:jobs", "momo-ocr-workers", "1-0")]


def test_redis_consumer_scans_pending_entries_until_stale_delivery() -> None:
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
        claimed=[
            (
                "2-0",
                {
                    "schemaVersion": "1",
                    "jobId": "job-2",
                    "draftId": "draft-2",
                    "imageId": "image-2",
                    "imagePath": "/tmp/sample.jpg",
                    "requestedScreenType": "total_assets",
                    "attempt": "1",
                    "enqueuedAt": "2026-04-29T10:00:00Z",
                },
            )
        ],
    )
    consumer = RedisOcrJobConsumer(
        cast("Redis", redis),
        stream="momo:ocr:jobs",
        group="momo-ocr-workers",
        consumer_name="worker-1",
        retry_config=RedisConsumerRetryConfig(
            max_attempts=2,
            dead_letter_stream="momo:ocr:jobs:dead",
            claim_idle_ms=30_000,
            pending_scan_count=2,
        ),
    )

    pulled = consumer.pull()

    assert redis.pending_range_counts == [2]
    assert redis.claimed_message_ids == [["2-0"]]
    assert isinstance(pulled, PulledJob)
    assert pulled.delivery_tag == "2-0"
    assert pulled.message.job_id == "job-2"
