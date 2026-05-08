from __future__ import annotations

import psycopg
import pytest
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobExecutionResult, OcrJobStatus
from momo_ocr.features.ocr_jobs.repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.result_writer import OcrResultRecord, PostgresOcrResultWriter
from tests.integration.momo_db import migrated_postgres_conninfo


@pytest.mark.integration
def test_postgres_repository_transitions_job_lifecycle() -> None:
    with migrated_postgres_conninfo() as conninfo:
        _insert_job(conninfo, job_id="job-1", draft_id="draft-1")
        with ConnectionPool(conninfo, min_size=1, max_size=2, open=True) as pool:
            repository = PostgresOcrJobRepository(pool)

            record = repository.get_for_update("job-1")
            assert record is not None
            assert record.status is OcrJobStatus.QUEUED

            repository.transition_to_running("job-1", worker_id="worker-it")
            repository.complete(
                "job-1",
                OcrJobExecutionResult(
                    status=OcrJobStatus.SUCCEEDED,
                    draft_payload=OcrDraftPayload(
                        requested_screen_type=ScreenType.TOTAL_ASSETS,
                        detected_screen_type=ScreenType.TOTAL_ASSETS,
                        profile_id="total-assets-test",
                    ),
                    failure=None,
                    warnings=[],
                    duration_ms=12.4,
                ),
            )

        with psycopg.connect(conninfo) as conn:
            row = conn.execute(
                "SELECT status, attempt_count, worker_id, detected_screen_type, duration_ms "
                "FROM ocr_jobs WHERE id = %s",
                ("job-1",),
            ).fetchone()
        assert row == ("succeeded", 1, "worker-it", "total_assets", 12)


@pytest.mark.integration
def test_postgres_result_writer_upserts_one_draft_per_job() -> None:
    with migrated_postgres_conninfo() as conninfo:
        _insert_job(conninfo, job_id="job-1", draft_id="draft-1")
        with ConnectionPool(conninfo, min_size=1, max_size=2, open=True) as pool:
            writer = PostgresOcrResultWriter(pool)

            writer.persist(
                OcrResultRecord(
                    job_id="job-1",
                    draft_id="draft-1",
                    payload=OcrDraftPayload(
                        requested_screen_type=ScreenType.REVENUE,
                        detected_screen_type=ScreenType.REVENUE,
                        profile_id="revenue-test",
                    ),
                    warnings=(),
                    timings_ms={"total": 8.0},
                )
            )
            writer.persist(
                OcrResultRecord(
                    job_id="job-1",
                    draft_id="draft-1",
                    payload=OcrDraftPayload(
                        requested_screen_type=ScreenType.REVENUE,
                        detected_screen_type=ScreenType.REVENUE,
                        profile_id="revenue-test-2",
                    ),
                    warnings=(),
                    timings_ms={"total": 9.0},
                )
            )

        with psycopg.connect(conninfo) as conn:
            row = conn.execute(
                "SELECT count(*), max(profile_id), max(timings_ms_json->>'total') "
                "FROM ocr_drafts WHERE job_id = %s",
                ("job-1",),
            ).fetchone()
        assert row == (1, "revenue-test-2", "9.0")


def _insert_job(conninfo: str, *, job_id: str, draft_id: str) -> None:
    with psycopg.connect(conninfo) as conn:
        conn.execute(
            """
            INSERT INTO ocr_jobs (
              id, draft_id, image_id, image_path,
              requested_screen_type, status, attempt_count
            ) VALUES (%s, %s, 'image-1', '/tmp/image.png', 'total_assets', 'queued', 0)
            """,
            (job_id, draft_id),
        )
        conn.execute(
            """
            INSERT INTO ocr_drafts (
              id, job_id, requested_screen_type,
              payload_json, warnings_json, timings_ms_json
            ) VALUES (%s, %s, 'total_assets', %s, %s, %s)
            """,
            (draft_id, job_id, Jsonb({}), Jsonb([]), Jsonb({})),
        )
