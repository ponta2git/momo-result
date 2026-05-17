from __future__ import annotations

from typing import cast

import pytest
from redis import Redis
from redis.typing import EncodableT

from momo_ocr.features.ocr_jobs.consumer import RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.models import PulledJob
from tests.integration.resources import OcrJobIds, RedisNames


@pytest.mark.integration
def test_redis_consumer_reads_stream_delivery_from_testcontainer(
    redis_client: Redis,
    redis_names: RedisNames,
    ocr_job_ids: OcrJobIds,
) -> None:
    payload: dict[EncodableT, EncodableT] = {
        "schemaVersion": "1",
        "jobId": ocr_job_ids.job_id,
        "draftId": ocr_job_ids.draft_id,
        "imageId": ocr_job_ids.image_id,
        "imagePath": ocr_job_ids.image_path,
        "requestedScreenType": "total_assets",
        "attempt": "1",
        "enqueuedAt": "2026-04-29T10:00:00Z",
    }
    redis_client.xadd(redis_names.stream, payload)
    consumer = RedisOcrJobConsumer(
        redis_client,
        stream=redis_names.stream,
        group=redis_names.group,
        consumer_name=redis_names.consumer,
        block_ms=100,
    )

    pulled = consumer.pull()

    assert pulled is not None
    assert isinstance(pulled, PulledJob)
    assert pulled.message.job_id == ocr_job_ids.job_id
    assert pulled.delivery_tag
    consumer.ack(pulled.delivery_tag)
    pending = cast(
        "dict[str, int | str | None]",
        redis_client.xpending(redis_names.stream, redis_names.group),
    )
    assert pending["pending"] == 0
