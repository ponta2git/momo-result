from __future__ import annotations

from pathlib import Path

import psycopg
import pytest
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from redis import Redis
from redis.typing import EncodableT

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.cancellation import RepositoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.dependencies import JobRunnerDependencies
from momo_ocr.features.ocr_jobs.models import OcrJobStatus
from momo_ocr.features.ocr_jobs.queue_contract import to_stream_payload
from momo_ocr.features.ocr_jobs.repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.runner import run_one_job
from tests.integration.resources import OcrJobIds, RedisNames
from tests.support.ocr_jobs import (
    AnalyzeStub,
    make_job_message,
    success_draft_payload,
    successful_analysis,
)

pytestmark = [pytest.mark.integration, pytest.mark.e2e]


def test_redis_to_worker_to_postgres_smoke(
    redis_client: Redis,
    redis_names: RedisNames,
    postgres_conninfo: str,
    ocr_job_ids: OcrJobIds,
) -> None:
    _insert_job(postgres_conninfo, ids=ocr_job_ids)

    message = make_job_message(
        job_id=ocr_job_ids.job_id,
        draft_id=ocr_job_ids.draft_id,
        image_id=ocr_job_ids.image_id,
        image_path=Path(ocr_job_ids.image_path),
        requested_screen_type=ScreenType.TOTAL_ASSETS,
        enqueued_at="2026-04-29T10:00:00Z",
    )
    stream_payload: dict[EncodableT, EncodableT] = dict(to_stream_payload(message).items())
    redis_client.xadd(redis_names.stream, stream_payload)

    consumer = RedisOcrJobConsumer(
        redis_client,
        stream=redis_names.stream,
        group=redis_names.group,
        consumer_name=redis_names.consumer,
        block_ms=100,
    )
    repository: PostgresOcrJobRepository
    with ConnectionPool(postgres_conninfo, min_size=1, max_size=2, open=True) as pool:
        repository = PostgresOcrJobRepository(pool)
        deps = JobRunnerDependencies(
            consumer=consumer,
            repository=repository,
            cancellation=RepositoryCancellationChecker(repository),
            worker_id=redis_names.consumer,
            analyze=AnalyzeStub(
                result=successful_analysis(
                    success_draft_payload(profile_id="smoke-profile"),
                    timings_ms={"total": 1.0},
                )
            ),
        )

        outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.SUCCEEDED
    with psycopg.connect(postgres_conninfo) as conn:
        row = conn.execute(
            "SELECT j.status, j.attempt_count, d.profile_id "
            "FROM ocr_jobs j JOIN ocr_drafts d ON d.job_id = j.id "
            "WHERE j.id = %s",
            (ocr_job_ids.job_id,),
        ).fetchone()
    assert row == ("succeeded", 1, "smoke-profile")


def _insert_job(conninfo: str, *, ids: OcrJobIds) -> None:
    with psycopg.connect(conninfo) as conn:
        conn.execute(
            """
            INSERT INTO ocr_jobs (
              id, draft_id, image_id, image_path,
              requested_screen_type, status, attempt_count
            ) VALUES (%s, %s, %s, %s, 'total_assets', 'queued', 0)
            """,
            (ids.job_id, ids.draft_id, ids.image_id, ids.image_path),
        )
        conn.execute(
            """
            INSERT INTO ocr_drafts (
              id, job_id, requested_screen_type,
              payload_json, warnings_json, timings_ms_json
            ) VALUES (%s, %s, 'total_assets', %s, %s, %s)
            """,
            (ids.draft_id, ids.job_id, Jsonb({}), Jsonb([]), Jsonb({})),
        )
