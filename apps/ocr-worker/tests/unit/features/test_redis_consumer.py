from __future__ import annotations

from typing import cast

import pytest
from redis import Redis

from momo_ocr.app.config import WorkerConfig
from momo_ocr.features.ocr_jobs import consumer as consumer_module
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

    def xgroup_create(self, **_kwargs: object) -> None:
        self.group_created = True

    def xreadgroup(self, **_kwargs: object) -> object:
        return self.deliveries

    def xpending_range(self, *_args: object, **_kwargs: object) -> object:
        return self.pending_entries

    def xclaim(self, *_args: object, **_kwargs: object) -> object:
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
                            "requestedImageType": "total_assets",
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
        ),
    )

    pulled = consumer.pull()

    assert pulled is None
    assert redis.dead_letters[0][0] == "momo:ocr:jobs:dead"
    assert redis.dead_letters[0][1]["deadLetterReason"] == "QUEUE_FAILURE"
    assert redis.acked == [("momo:ocr:jobs", "momo-ocr-workers", "1-0")]


def test_redis_consumer_from_config_enables_health_check_and_keepalive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``from_config`` must wire keepalive + periodic PING.

    Fly.io <-> Upstash NAT silently drops idle TCP sessions, which would
    otherwise leave ``XREADGROUP`` blocking forever on the dead socket.
    """
    captured: dict[str, object] = {}

    class _StubRedis:
        @classmethod
        def from_url(cls, url: str, **kwargs: object) -> _StubRedis:
            captured["url"] = url
            captured.update(kwargs)
            return cls()

        def xgroup_create(self, **_kwargs: object) -> None:
            pass

    monkeypatch.setattr(consumer_module, "Redis", _StubRedis)

    config = WorkerConfig(redis_url="redis://example:6379/0", worker_id="w-1")
    RedisOcrJobConsumer.from_config(config)

    assert captured["url"] == "redis://example:6379/0"
    assert captured["decode_responses"] is True
    assert captured["health_check_interval"] == 30
    assert captured["socket_keepalive"] is True
