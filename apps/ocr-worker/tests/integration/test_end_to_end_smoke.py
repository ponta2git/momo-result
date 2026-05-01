from __future__ import annotations

from pathlib import Path

import psycopg
import pytest
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from redis import Redis
from redis.typing import EncodableT
from testcontainers.postgres import PostgresContainer  # type: ignore[import-untyped]
from testcontainers.redis import RedisContainer  # type: ignore[import-untyped]

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.ocr_jobs.cancellation import RepositoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.models import OcrJobHints, OcrJobMessage, OcrJobStatus
from momo_ocr.features.ocr_jobs.queue_contract import to_stream_payload
from momo_ocr.features.ocr_jobs.repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.result_writer import PostgresOcrResultWriter
from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies, run_one_job
from momo_ocr.features.standalone_analysis.report import AnalysisResult

POSTGRES_PASSWORD = "test"  # noqa: S105


@pytest.mark.integration
def test_redis_to_worker_to_postgres_smoke() -> None:
    redis_container = RedisContainer("redis:7-alpine")
    postgres_container = PostgresContainer(
        "postgres:16-alpine",
        username="test",
        password=POSTGRES_PASSWORD,
        dbname="test",
        driver=None,
    )
    try:
        redis_container.start()
        postgres_container.start()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Docker is not available for OCR smoke Testcontainers: {exc}")
    try:
        redis_url = (
            f"redis://{redis_container.get_container_host_ip()}:"
            f"{redis_container.get_exposed_port(6379)}/0"
        )
        conninfo = f"{postgres_container.get_connection_url(driver=None)}?sslmode=disable"
        _create_schema(conninfo)
        _insert_job(conninfo)

        redis_client = Redis.from_url(redis_url, decode_responses=True)
        message = OcrJobMessage(
            job_id="job-1",
            draft_id="draft-1",
            image_id="image-1",
            image_path=Path("/tmp/image.png"),
            requested_screen_type=ScreenType.TOTAL_ASSETS,
            attempt=1,
            enqueued_at="2026-04-29T10:00:00Z",
            hints=OcrJobHints(),
        )
        stream_payload: dict[EncodableT, EncodableT] = dict(to_stream_payload(message).items())
        redis_client.xadd("momo:ocr:jobs", stream_payload)

        consumer = RedisOcrJobConsumer(
            redis_client,
            stream="momo:ocr:jobs",
            group="momo-ocr-workers",
            consumer_name="worker-it",
            block_ms=100,
        )
        repository: PostgresOcrJobRepository
        with ConnectionPool(conninfo, min_size=1, max_size=2, open=True) as pool:
            repository = PostgresOcrJobRepository(pool)
            deps = JobRunnerDependencies(
                consumer=consumer,
                repository=repository,
                result_writer=PostgresOcrResultWriter(pool),
                cancellation=RepositoryCancellationChecker(repository),
                worker_id="worker-it",
                analyze=_fake_success_analysis,
                delete_image=lambda _path: True,
            )

            outcome = run_one_job(deps)

        assert outcome.status is OcrJobStatus.SUCCEEDED
        with psycopg.connect(conninfo) as conn:
            row = conn.execute(
                "SELECT j.status, j.attempt_count, d.profile_id "
                "FROM ocr_jobs j JOIN ocr_drafts d ON d.job_id = j.id "
                "WHERE j.id = %s",
                ("job-1",),
            ).fetchone()
        assert row == ("succeeded", 1, "smoke-profile")
    finally:
        redis_container.stop()
        postgres_container.stop()


def _fake_success_analysis(**_kwargs: object) -> AnalysisResult:
    return AnalysisResult(
        input=None,
        detection=None,
        result=OcrDraftPayload(
            requested_screen_type=ScreenType.TOTAL_ASSETS,
            detected_screen_type=ScreenType.TOTAL_ASSETS,
            profile_id="smoke-profile",
        ),
        warnings=[],
        failure_code=None,
        failure_message=None,
        failure_retryable=False,
        failure_user_action=None,
        timings_ms={"total": 1.0},
    )


def _create_schema(conninfo: str) -> None:
    with psycopg.connect(conninfo) as conn:
        conn.execute(
            """
            CREATE TABLE ocr_jobs (
              id text PRIMARY KEY,
              draft_id text NOT NULL,
              image_id text NOT NULL,
              image_path text NOT NULL,
              requested_screen_type text NOT NULL,
              detected_screen_type text,
              status text NOT NULL,
              attempt_count integer NOT NULL DEFAULT 0,
              worker_id text,
              failure_code text,
              failure_message text,
              failure_retryable boolean,
              failure_user_action text,
              started_at timestamptz,
              finished_at timestamptz,
              duration_ms integer,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE ocr_drafts (
              id text PRIMARY KEY,
              job_id text NOT NULL UNIQUE REFERENCES ocr_jobs(id),
              requested_screen_type text NOT NULL,
              detected_screen_type text,
              profile_id text,
              payload_json jsonb NOT NULL,
              warnings_json jsonb NOT NULL,
              timings_ms_json jsonb NOT NULL,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )


def _insert_job(conninfo: str) -> None:
    with psycopg.connect(conninfo) as conn:
        conn.execute(
            """
            INSERT INTO ocr_jobs (
              id, draft_id, image_id, image_path,
              requested_screen_type, status, attempt_count
            ) VALUES ('job-1', 'draft-1', 'image-1', '/tmp/image.png', 'total_assets', 'queued', 0)
            """
        )
        conn.execute(
            """
            INSERT INTO ocr_drafts (
              id, job_id, requested_screen_type,
              payload_json, warnings_json, timings_ms_json
            ) VALUES ('draft-1', 'job-1', 'total_assets', %s, %s, %s)
            """,
            (Jsonb({}), Jsonb([]), Jsonb({})),
        )
