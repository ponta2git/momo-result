from __future__ import annotations

from typing import cast

from redis import Redis

from momo_ocr.features.ocr_jobs.consumer import RedisOcrJobConsumer


class FakeRedis:
    def __init__(self, deliveries: object) -> None:
        self.deliveries = deliveries
        self.acked: list[tuple[str, str, str]] = []
        self.group_created = False

    def xgroup_create(self, **_kwargs: object) -> None:
        self.group_created = True

    def xreadgroup(self, **_kwargs: object) -> object:
        return self.deliveries

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
    assert pulled.delivery_tag == "1-0"
    assert pulled.message.job_id == "job-1"


def test_redis_consumer_acks_and_drops_malformed_delivery() -> None:
    redis = FakeRedis([("momo:ocr:jobs", [("1-0", {"jobId": "job-1"})])])
    consumer = RedisOcrJobConsumer(
        cast("Redis", redis),
        stream="momo:ocr:jobs",
        group="momo-ocr-workers",
        consumer_name="worker-1",
    )

    pulled = consumer.pull()

    assert pulled is None
    assert redis.acked == [("momo:ocr:jobs", "momo-ocr-workers", "1-0")]
