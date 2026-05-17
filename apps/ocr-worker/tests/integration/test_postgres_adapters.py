from __future__ import annotations

import psycopg
import pytest
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobExecutionResult, OcrJobStatus
from momo_ocr.features.ocr_jobs.repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from tests.integration.resources import OcrJobIds


@pytest.mark.integration
def test_postgres_repository_transitions_job_lifecycle(
    postgres_conninfo: str,
    ocr_job_ids: OcrJobIds,
) -> None:
    _insert_job(postgres_conninfo, ids=ocr_job_ids)
    worker_id = f"worker-it-{ocr_job_ids.job_id}"
    with ConnectionPool(postgres_conninfo, min_size=1, max_size=2, open=True) as pool:
        repository = PostgresOcrJobRepository(pool)

        record = repository.get_record(ocr_job_ids.job_id)
        assert record is not None
        assert record.status is OcrJobStatus.QUEUED

        repository.transition_to_running(ocr_job_ids.job_id, worker_id=worker_id)
        payload = OcrDraftPayload(
            requested_screen_type=ScreenType.TOTAL_ASSETS,
            detected_screen_type=ScreenType.TOTAL_ASSETS,
            profile_id=f"total-assets-{ocr_job_ids.job_id}",
        )
        repository.complete_success(
            ocr_job_ids.job_id,
            OcrResultRecord(
                job_id=ocr_job_ids.job_id,
                draft_id=ocr_job_ids.draft_id,
                payload=payload,
                warnings=(),
                timings_ms={"total": 12.4},
            ),
            OcrJobExecutionResult(
                status=OcrJobStatus.SUCCEEDED,
                draft_payload=payload,
                failure=None,
                warnings=[],
                duration_ms=12.4,
            ),
        )

    with psycopg.connect(postgres_conninfo) as conn:
        job_row = conn.execute(
            "SELECT status, attempt_count, worker_id, detected_screen_type, duration_ms "
            "FROM ocr_jobs WHERE id = %s",
            (ocr_job_ids.job_id,),
        ).fetchone()
        draft_row = conn.execute(
            "SELECT count(*), max(profile_id), max(timings_ms_json->>'total') "
            "FROM ocr_drafts WHERE job_id = %s",
            (ocr_job_ids.job_id,),
        ).fetchone()
    assert job_row == ("succeeded", 1, worker_id, "total_assets", 12)
    assert draft_row == (1, f"total-assets-{ocr_job_ids.job_id}", "12.4")


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
