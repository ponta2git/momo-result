from __future__ import annotations

from contextlib import suppress

import psycopg
from psycopg_pool import ConnectionPool

from momo_ocr.features.ocr_jobs.lifecycle import ensure_transition_allowed
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobRecord,
    OcrJobStatus,
)
from momo_ocr.features.ocr_jobs.postgres_match_drafts import (
    sync_match_draft_status_for_terminal_job,
)
from momo_ocr.features.ocr_jobs.postgres_rows import SELECT_JOB, row_to_record, select_status
from momo_ocr.features.ocr_jobs.repository_contract import (
    ensure_non_success_result,
    ensure_success_result,
    ensure_terminal_result,
)
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord, persist_result_record
from momo_ocr.shared.errors import FailureCode, OcrError


class PostgresOcrJobRepository:
    """Postgres adapter backed by a caller-owned shared connection pool."""

    def __init__(self, pool: ConnectionPool) -> None:
        self._pool = pool

    def get_record(self, job_id: str) -> OcrJobRecord | None:
        with self._pool.connection() as conn:
            return row_to_record(conn.execute(SELECT_JOB, (job_id,)).fetchone())

    def claim_for_running(self, job_id: str, *, worker_id: str) -> OcrJobRecord | None:
        with self._pool.connection() as conn, conn.transaction():
            row = conn.execute(
                """
                UPDATE ocr_jobs SET
                  status = 'running',
                  worker_id = %s,
                  attempt_count = attempt_count + 1,
                  started_at = COALESCE(started_at, now()),
                  updated_at = now()
                WHERE id = %s AND status = 'queued'
                RETURNING
                  id, draft_id, image_id, image_path,
                  requested_screen_type, detected_screen_type,
                  status, attempt_count, worker_id,
                  failure_code, failure_message, failure_retryable, failure_user_action
                """,
                (worker_id, job_id),
            ).fetchone()
            if row is not None:
                return row_to_record(row)
            return row_to_record(conn.execute(SELECT_JOB, (job_id,)).fetchone())

    def complete_success(
        self,
        job_id: str,
        result_record: OcrResultRecord,
        result: OcrJobExecutionResult,
    ) -> None:
        ensure_success_result(result_record, result)
        self._terminal_transition(
            job_id,
            result,
            expected=OcrJobStatus.SUCCEEDED,
            result_record=result_record,
        )

    def complete_non_success(self, job_id: str, result: OcrJobExecutionResult) -> None:
        ensure_non_success_result(result)
        self._terminal_transition(job_id, result, expected=result.status)

    def get_status(self, job_id: str) -> OcrJobStatus | None:
        with self._pool.connection() as conn:
            return select_status(conn, job_id)

    def _terminal_transition(
        self,
        job_id: str,
        result: OcrJobExecutionResult,
        *,
        expected: OcrJobStatus,
        result_record: OcrResultRecord | None = None,
    ) -> None:
        ensure_terminal_result(result, expected)
        with self._pool.connection() as conn, conn.transaction():
            current = select_status(conn, job_id)
            if current is None:
                raise OcrError(
                    FailureCode.DB_WRITE_FAILED,
                    f"OCR job {job_id} is not present; cannot complete.",
                    retryable=True,
                )
            ensure_transition_allowed(current, expected)
            if result_record is not None:
                persist_result_record(conn, result_record)
            self._update_terminal_job(conn, job_id, result, expected)
            with suppress(psycopg.errors.UndefinedTable), conn.transaction():
                sync_match_draft_status_for_terminal_job(conn, job_id)

    def _update_terminal_job(
        self,
        conn: psycopg.Connection[object],
        job_id: str,
        result: OcrJobExecutionResult,
        expected: OcrJobStatus,
    ) -> None:
        detected_screen_type = (
            result.draft_payload.detected_screen_type.value
            if result.draft_payload is not None
            and result.draft_payload.detected_screen_type is not None
            else None
        )
        failure = result.failure
        updated = conn.execute(
            """
            UPDATE ocr_jobs SET
              status = %s,
              detected_screen_type = COALESCE(%s, detected_screen_type),
              failure_code = %s,
              failure_message = %s,
              failure_retryable = %s,
              failure_user_action = %s,
              finished_at = now(),
              duration_ms = %s,
              updated_at = now()
            WHERE id = %s AND status IN ('queued', 'running')
            """,
            (
                expected.value,
                detected_screen_type,
                failure.code.value if failure is not None else None,
                failure.message if failure is not None else None,
                failure.retryable if failure is not None else None,
                failure.user_action if failure is not None else None,
                round(result.duration_ms),
                job_id,
            ),
        ).rowcount
        if updated != 1:
            raise OcrError(
                FailureCode.DB_WRITE_FAILED,
                f"OCR job {job_id} terminal transition did not update exactly one row.",
                retryable=True,
            )
