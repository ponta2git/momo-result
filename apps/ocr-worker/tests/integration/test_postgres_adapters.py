from __future__ import annotations

import psycopg
import pytest
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrWarning,
    ScreenType,
    WarningCode,
    WarningSeverity,
)
from momo_ocr.features.ocr_jobs.models import OcrJobExecutionResult, OcrJobStatus
from momo_ocr.features.ocr_jobs.repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from momo_ocr.shared.errors import FailureCode, OcrFailure
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

        claimed = repository.claim_for_running(ocr_job_ids.job_id, worker_id=worker_id)
        assert claimed is not None
        assert claimed.status is OcrJobStatus.RUNNING
        assert claimed.worker_id == worker_id
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


@pytest.mark.integration
def test_postgres_repository_claim_returns_running_owner_after_claim_race(
    postgres_conninfo: str,
    ocr_job_ids: OcrJobIds,
) -> None:
    _insert_job(postgres_conninfo, ids=ocr_job_ids)
    with ConnectionPool(postgres_conninfo, min_size=1, max_size=2, open=True) as pool:
        repository = PostgresOcrJobRepository(pool)

        claimed = repository.claim_for_running(ocr_job_ids.job_id, worker_id="worker-winner")
        duplicate = repository.claim_for_running(ocr_job_ids.job_id, worker_id="worker-loser")

    assert claimed is not None
    assert claimed.status is OcrJobStatus.RUNNING
    assert claimed.worker_id == "worker-winner"
    assert claimed.attempt_count == 1
    assert duplicate is not None
    assert duplicate.status is OcrJobStatus.RUNNING
    assert duplicate.worker_id == "worker-winner"
    assert duplicate.attempt_count == 1


@pytest.mark.integration
def test_postgres_repository_projects_match_draft_to_needs_review_when_all_slots_terminal(
    postgres_conninfo: str,
    ocr_job_ids: OcrJobIds,
) -> None:
    total_ids = ocr_job_ids
    revenue_ids = _ids_for_slot(ocr_job_ids, "revenue")
    _insert_job(postgres_conninfo, ids=total_ids)
    _insert_job(postgres_conninfo, ids=revenue_ids, requested_screen_type="revenue")
    _insert_match_draft(
        postgres_conninfo,
        match_draft_id=f"match-draft-{ocr_job_ids.job_id}",
        total_assets_draft_id=total_ids.draft_id,
        revenue_draft_id=revenue_ids.draft_id,
    )

    with ConnectionPool(postgres_conninfo, min_size=1, max_size=2, open=True) as pool:
        repository = PostgresOcrJobRepository(pool)
        _complete_success(repository, total_ids, worker_id=f"worker-{total_ids.job_id}")

        assert (
            _match_draft_status(
                postgres_conninfo,
                f"match-draft-{ocr_job_ids.job_id}",
            )
            == "ocr_running"
        )

        warning = OcrWarning(
            code=WarningCode.LOW_CONFIDENCE,
            message="Revenue OCR needs review.",
            severity=WarningSeverity.WARNING,
        )
        _complete_success(
            repository,
            revenue_ids,
            worker_id=f"worker-{revenue_ids.job_id}",
            screen_type=ScreenType.REVENUE,
            warnings=(warning,),
        )

    assert _match_draft_status(postgres_conninfo, f"match-draft-{ocr_job_ids.job_id}") == (
        "needs_review"
    )


@pytest.mark.integration
def test_postgres_repository_projects_match_draft_to_failed_when_any_slot_fails(
    postgres_conninfo: str,
    ocr_job_ids: OcrJobIds,
) -> None:
    total_ids = ocr_job_ids
    revenue_ids = _ids_for_slot(ocr_job_ids, "failed-revenue")
    _insert_job(postgres_conninfo, ids=total_ids)
    _insert_job(postgres_conninfo, ids=revenue_ids, requested_screen_type="revenue")
    _insert_match_draft(
        postgres_conninfo,
        match_draft_id=f"match-draft-{ocr_job_ids.job_id}",
        total_assets_draft_id=total_ids.draft_id,
        revenue_draft_id=revenue_ids.draft_id,
    )

    with ConnectionPool(postgres_conninfo, min_size=1, max_size=2, open=True) as pool:
        repository = PostgresOcrJobRepository(pool)
        _complete_success(repository, total_ids, worker_id=f"worker-{total_ids.job_id}")
        _complete_failure(repository, revenue_ids, worker_id=f"worker-{revenue_ids.job_id}")

    assert _match_draft_status(postgres_conninfo, f"match-draft-{ocr_job_ids.job_id}") == (
        "ocr_failed"
    )


def _insert_job(
    conninfo: str,
    *,
    ids: OcrJobIds,
    requested_screen_type: str = "total_assets",
) -> None:
    with psycopg.connect(conninfo) as conn:
        conn.execute(
            """
            INSERT INTO ocr_jobs (
              id, draft_id, image_id, image_path,
              requested_screen_type, status, attempt_count
            ) VALUES (%s, %s, %s, %s, %s, 'queued', 0)
            """,
            (ids.job_id, ids.draft_id, ids.image_id, ids.image_path, requested_screen_type),
        )
        conn.execute(
            """
            INSERT INTO ocr_drafts (
              id, job_id, requested_screen_type,
              payload_json, warnings_json, timings_ms_json
            ) VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (ids.draft_id, ids.job_id, requested_screen_type, Jsonb({}), Jsonb([]), Jsonb({})),
        )


def _insert_match_draft(
    conninfo: str,
    *,
    match_draft_id: str,
    total_assets_draft_id: str,
    revenue_draft_id: str,
) -> None:
    with psycopg.connect(conninfo) as conn:
        conn.execute(
            """
            INSERT INTO match_drafts (
              id, created_by_account_id, created_by_member_id, status,
              total_assets_draft_id, revenue_draft_id,
              created_at, updated_at
            ) VALUES (
              %s, 'account_ponta', 'member_ponta', 'ocr_running',
              %s, %s, now(), now()
            )
            """,
            (match_draft_id, total_assets_draft_id, revenue_draft_id),
        )


def _complete_success(
    repository: PostgresOcrJobRepository,
    ids: OcrJobIds,
    *,
    worker_id: str,
    screen_type: ScreenType = ScreenType.TOTAL_ASSETS,
    warnings: tuple[OcrWarning, ...] = (),
) -> None:
    claimed = repository.claim_for_running(ids.job_id, worker_id=worker_id)
    assert claimed is not None
    assert claimed.status is OcrJobStatus.RUNNING
    payload = OcrDraftPayload(
        requested_screen_type=screen_type,
        detected_screen_type=screen_type,
        profile_id=f"{screen_type.value}-{ids.job_id}",
        warnings=list(warnings),
    )
    repository.complete_success(
        ids.job_id,
        OcrResultRecord(
            job_id=ids.job_id,
            draft_id=ids.draft_id,
            payload=payload,
            warnings=warnings,
            timings_ms={"total": 1.0},
        ),
        OcrJobExecutionResult(
            status=OcrJobStatus.SUCCEEDED,
            draft_payload=payload,
            failure=None,
            warnings=list(warnings),
            duration_ms=1.0,
        ),
    )


def _complete_failure(
    repository: PostgresOcrJobRepository,
    ids: OcrJobIds,
    *,
    worker_id: str,
) -> None:
    claimed = repository.claim_for_running(ids.job_id, worker_id=worker_id)
    assert claimed is not None
    assert claimed.status is OcrJobStatus.RUNNING
    repository.complete_non_success(
        ids.job_id,
        OcrJobExecutionResult(
            status=OcrJobStatus.FAILED,
            draft_payload=None,
            failure=OcrFailure(
                code=FailureCode.PARSER_FAILED,
                message="Parser failed in integration fixture.",
                retryable=False,
            ),
            warnings=[],
            duration_ms=1.0,
        ),
    )


def _match_draft_status(conninfo: str, match_draft_id: str) -> str:
    with psycopg.connect(conninfo) as conn:
        row = conn.execute(
            "SELECT status FROM match_drafts WHERE id = %s",
            (match_draft_id,),
        ).fetchone()
    assert row is not None
    return str(row[0])


def _ids_for_slot(ids: OcrJobIds, slot: str) -> OcrJobIds:
    return OcrJobIds(
        job_id=f"{ids.job_id}-{slot}",
        draft_id=f"{ids.draft_id}-{slot}",
        image_id=f"{ids.image_id}-{slot}",
        image_path=f"/tmp/{ids.job_id}-{slot}.png",
    )
