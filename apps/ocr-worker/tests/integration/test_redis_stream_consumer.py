from __future__ import annotations

from typing import cast

import pytest
from redis import Redis
from redis.typing import EncodableT

from momo_ocr.features.ocr_jobs.consumer import RedisConsumerRetryConfig, RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.models import PulledJob
from momo_ocr.shared.errors import FailureCode, OcrFailure
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


@pytest.mark.integration
def test_redis_consumer_dead_letters_and_acks_with_real_redis(
    redis_client: Redis,
    redis_names: RedisNames,
    ocr_job_ids: OcrJobIds,
) -> None:
    dead_letter_stream = f"{redis_names.stream}:dead"
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
        retry_config=RedisConsumerRetryConfig(
            max_attempts=1,
            dead_letter_stream=dead_letter_stream,
            claim_idle_ms=1,
            pending_scan_count=10,
        ),
    )
    pulled = consumer.pull()
    assert isinstance(pulled, PulledJob)

    consumer.dead_letter(
        pulled.delivery_tag,
        {str(key): str(value) for key, value in payload.items()},
        failure=OcrFailure(
            code=FailureCode.QUEUE_FAILURE,
            message="OCR queue delivery exceeded max attempts.",
        ),
        deliveries=2,
    )

    dead_entries = cast(
        "list[tuple[str, dict[str, str]]]",
        redis_client.xrange(dead_letter_stream),
    )
    pending = cast(
        "dict[str, int | str | None]",
        redis_client.xpending(redis_names.stream, redis_names.group),
    )
    assert pending["pending"] == 0
    assert len(dead_entries) == 1
    assert dead_entries[0][1]["jobId"] == ocr_job_ids.job_id
    assert dead_entries[0][1]["deadLetterReason"] == "QUEUE_FAILURE"
    assert dead_entries[0][1]["deadLetterDeliveries"] == "2"
