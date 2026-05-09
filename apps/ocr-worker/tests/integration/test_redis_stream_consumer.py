from __future__ import annotations

from typing import cast

import pytest
from redis import Redis
from redis.typing import EncodableT
from testcontainers.core.container import DockerContainer
from testcontainers.core.wait_strategies import ExecWaitStrategy

from momo_ocr.features.ocr_jobs.consumer import RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.models import PulledJob


@pytest.mark.integration
def test_redis_consumer_reads_stream_delivery_from_testcontainer() -> None:
    container = (
        DockerContainer("redis:7-alpine")
        .with_exposed_ports(6379)
        .waiting_for(ExecWaitStrategy(["redis-cli", "ping"]))
    )
    try:
        container.start()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Docker is not available for Redis Testcontainer: {exc}")
    try:
        redis_url = (
            f"redis://{container.get_container_host_ip()}:{container.get_exposed_port(6379)}/0"
        )
        client = Redis.from_url(redis_url, decode_responses=True)
        payload: dict[EncodableT, EncodableT] = {
            "schemaVersion": "1",
            "jobId": "job-1",
            "draftId": "draft-1",
            "imageId": "image-1",
            "imagePath": "/tmp/sample.jpg",
            "requestedImageType": "total_assets",
            "attempt": "1",
            "enqueuedAt": "2026-04-29T10:00:00Z",
        }
        client.xadd("momo:ocr:jobs", payload)
        consumer = RedisOcrJobConsumer(
            client,
            stream="momo:ocr:jobs",
            group="momo-ocr-workers",
            consumer_name="worker-it",
            block_ms=100,
        )

        pulled = consumer.pull()

        assert pulled is not None
        assert isinstance(pulled, PulledJob)
        assert pulled.message.job_id == "job-1"
        assert pulled.delivery_tag
        consumer.ack(pulled.delivery_tag)
        pending = cast(
            "dict[str, int | str | None]",
            client.xpending("momo:ocr:jobs", "momo-ocr-workers"),
        )
        assert pending["pending"] == 0
    finally:
        container.stop()
