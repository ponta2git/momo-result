from __future__ import annotations

from collections.abc import Iterator

import pytest
from redis import Redis
from testcontainers.core.container import DockerContainer
from testcontainers.core.wait_strategies import ExecWaitStrategy

from tests.integration.momo_db import migrated_postgres_conninfo
from tests.integration.resources import OcrJobIds, RedisNames, resource_suffix


@pytest.fixture(scope="session")
def redis_url() -> Iterator[str]:
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
        yield f"redis://{container.get_container_host_ip()}:{container.get_exposed_port(6379)}/0"
    finally:
        container.stop()


@pytest.fixture(scope="session")
def postgres_conninfo() -> Iterator[str]:
    with migrated_postgres_conninfo() as conninfo:
        yield conninfo


@pytest.fixture
def redis_client(redis_url: str) -> Iterator[Redis]:
    client = Redis.from_url(redis_url, decode_responses=True)
    try:
        yield client
    finally:
        client.close()


@pytest.fixture
def redis_names(request: pytest.FixtureRequest) -> RedisNames:
    suffix = resource_suffix(request.node.nodeid)
    return RedisNames(
        stream=f"momo:ocr:jobs:{suffix}",
        group=f"momo-ocr-workers:{suffix}",
        consumer=f"worker-it-{suffix}",
    )


@pytest.fixture
def ocr_job_ids(request: pytest.FixtureRequest) -> OcrJobIds:
    suffix = resource_suffix(request.node.nodeid)
    return OcrJobIds(
        job_id=f"job-{suffix}",
        draft_id=f"draft-{suffix}",
        image_id=f"image-{suffix}",
        image_path=f"/tmp/{suffix}.png",
    )
