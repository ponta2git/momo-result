from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass, field, replace
from pathlib import Path
from threading import Lock
from typing import Protocol

import psycopg
from psycopg.rows import TupleRow
from psycopg_pool import ConnectionPool

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.lifecycle import ensure_transition_allowed
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobRecord,
    OcrJobStatus,
)
from momo_ocr.features.ocr_jobs.result_writer import OcrResultRecord, persist_result_record
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure

_SELECT_JOB_FOR_UPDATE = """
    SELECT
      id, draft_id, image_id, image_path,
      requested_screen_type, detected_screen_type,
      status, attempt_count, worker_id,
      failure_code, failure_message, failure_retryable, failure_user_action
    FROM ocr_jobs
    WHERE id = %s
    FOR UPDATE
"""


class OcrJobRepository(Protocol):
    def get_for_update(self, job_id: str) -> OcrJobRecord | None:
        raise NotImplementedError

    def transition_to_running(self, job_id: str, *, worker_id: str) -> None:
        raise NotImplementedError

    def complete(self, job_id: str, result: OcrJobExecutionResult) -> None:
        raise NotImplementedError

    def complete_success(
        self,
        job_id: str,
        result_record: OcrResultRecord,
        result: OcrJobExecutionResult,
    ) -> None:
        raise NotImplementedError

    def transition_to_failed_terminal(self, job_id: str, result: OcrJobExecutionResult) -> None:
        raise NotImplementedError

    def get_status(self, job_id: str) -> OcrJobStatus | None:
        raise NotImplementedError


@dataclass
class InMemoryOcrJobRepository:
    """Test double implementing :class:`OcrJobRepository`.

    Tracks the canonical status, attempt count, worker ownership, and the
    latest execution result for each job in process memory. The helper
    :meth:`seed` lets tests insert rows in arbitrary starting states.
    """

    records: dict[str, OcrJobRecord] = field(default_factory=dict)
    completions: dict[str, OcrJobExecutionResult] = field(default_factory=dict)
    result_records: dict[str, OcrResultRecord] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)

    def seed(self, record: OcrJobRecord) -> None:
        with self._lock:
            self.records[record.job_id] = record

    def get_for_update(self, job_id: str) -> OcrJobRecord | None:
        with self._lock:
            return self.records.get(job_id)

    def transition_to_running(self, job_id: str, *, worker_id: str) -> None:
        with self._lock:
            current = self.records.get(job_id)
            if current is None:
                raise OcrError(
                    FailureCode.DB_WRITE_FAILED,
                    f"OCR job {job_id} is not present; cannot transition to running.",
                )
            ensure_transition_allowed(current.status, OcrJobStatus.RUNNING)
            self.records[job_id] = replace(
                current,
                status=OcrJobStatus.RUNNING,
                worker_id=worker_id,
                attempt_count=current.attempt_count + 1,
            )

    def complete(self, job_id: str, result: OcrJobExecutionResult) -> None:
        self._terminal_transition(job_id, result, expected=OcrJobStatus.SUCCEEDED)

    def complete_success(
        self,
        job_id: str,
        result_record: OcrResultRecord,
        result: OcrJobExecutionResult,
    ) -> None:
        self._terminal_transition(job_id, result, expected=OcrJobStatus.SUCCEEDED)
        with self._lock:
            self.result_records[result_record.job_id] = result_record

    def transition_to_failed_terminal(self, job_id: str, result: OcrJobExecutionResult) -> None:
        if result.status not in {OcrJobStatus.FAILED, OcrJobStatus.CANCELLED}:
            raise OcrError(
                FailureCode.DB_WRITE_FAILED,
                f"Failed-terminal transition received non-failure status: {result.status.value}.",
            )
        self._terminal_transition(job_id, result, expected=result.status)

    def get_status(self, job_id: str) -> OcrJobStatus | None:
        with self._lock:
            current = self.records.get(job_id)
            return None if current is None else current.status

    def _terminal_transition(
        self,
        job_id: str,
        result: OcrJobExecutionResult,
        *,
        expected: OcrJobStatus,
    ) -> None:
        with self._lock:
            current = self.records.get(job_id)
            if current is None:
                raise OcrError(
                    FailureCode.DB_WRITE_FAILED,
                    f"OCR job {job_id} is not present; cannot complete.",
                )
            ensure_transition_allowed(current.status, expected)
            detected = (
                result.draft_payload.detected_screen_type
                if result.draft_payload is not None
                else current.detected_screen_type
            )
            self.records[job_id] = replace(
                current,
                status=expected,
                detected_screen_type=detected,
                failure=result.failure,
            )
            self.completions[job_id] = result


class PostgresOcrJobRepository:
    """Postgres adapter that serves every call from a shared connection pool.

    The pool is owned by the caller (typically the worker composition root)
    so multiple repositories / writers can share a single set of warm
    connections. We never open a connection per call: that pattern caused
    one TLS+auth round-trip per state transition (≈6 per job) which is
    expensive against Neon and unfriendly to its connection cap.
    """

    def __init__(self, pool: ConnectionPool) -> None:
        self._pool = pool

    def get_for_update(self, job_id: str) -> OcrJobRecord | None:
        with self._pool.connection() as conn, conn.transaction():
            row = conn.execute(
                _SELECT_JOB_FOR_UPDATE,
                (job_id,),
            ).fetchone()
            return _row_to_record(row)

    def transition_to_running(self, job_id: str, *, worker_id: str) -> None:
        with self._pool.connection() as conn, conn.transaction():
            updated = conn.execute(
                """
                UPDATE ocr_jobs SET
                  status = 'running',
                  worker_id = %s,
                  attempt_count = attempt_count + 1,
                  started_at = COALESCE(started_at, now()),
                  updated_at = now()
                WHERE id = %s AND status = 'queued'
                """,
                (worker_id, job_id),
            ).rowcount
            if updated == 1:
                return
            current = _select_status(conn, job_id)
            if current is None:
                raise OcrError(
                    FailureCode.DB_WRITE_FAILED,
                    f"OCR job {job_id} is not present; cannot transition to running.",
                    retryable=True,
                )
            ensure_transition_allowed(current, OcrJobStatus.RUNNING)
            raise OcrError(
                FailureCode.DB_WRITE_FAILED,
                f"OCR job {job_id} was not claimed for running.",
                retryable=True,
            )

    def complete(self, job_id: str, result: OcrJobExecutionResult) -> None:
        self._terminal_transition(job_id, result, expected=OcrJobStatus.SUCCEEDED)

    def complete_success(
        self,
        job_id: str,
        result_record: OcrResultRecord,
        result: OcrJobExecutionResult,
    ) -> None:
        self._terminal_transition(
            job_id,
            result,
            expected=OcrJobStatus.SUCCEEDED,
            result_record=result_record,
        )

    def transition_to_failed_terminal(self, job_id: str, result: OcrJobExecutionResult) -> None:
        if result.status not in {OcrJobStatus.FAILED, OcrJobStatus.CANCELLED}:
            raise OcrError(
                FailureCode.DB_WRITE_FAILED,
                f"Failed-terminal transition received non-failure status: {result.status.value}.",
            )
        self._terminal_transition(job_id, result, expected=result.status)

    def get_status(self, job_id: str) -> OcrJobStatus | None:
        with self._pool.connection() as conn:
            return _select_status(conn, job_id)

    def _terminal_transition(
        self,
        job_id: str,
        result: OcrJobExecutionResult,
        *,
        expected: OcrJobStatus,
        result_record: OcrResultRecord | None = None,
    ) -> None:
        detected_screen_type = (
            result.draft_payload.detected_screen_type.value
            if result.draft_payload is not None
            and result.draft_payload.detected_screen_type is not None
            else None
        )
        failure = result.failure
        with self._pool.connection() as conn, conn.transaction():
            current = _select_status(conn, job_id)
            if current is None:
                raise OcrError(
                    FailureCode.DB_WRITE_FAILED,
                    f"OCR job {job_id} is not present; cannot complete.",
                    retryable=True,
                )
            ensure_transition_allowed(current, expected)
            if result_record is not None:
                persist_result_record(conn, result_record)
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
            # Keep worker portable for environments that only provision OCR tables.
            # The optional sync needs a savepoint: once PostgreSQL raises
            # UndefinedTable, the current transaction is aborted until rolled
            # back, and we must not lose the terminal job update above.
            with suppress(psycopg.errors.UndefinedTable), conn.transaction():
                _sync_match_draft_status_for_terminal_job(conn, job_id)


def _select_status(conn: psycopg.Connection[TupleRow], job_id: str) -> OcrJobStatus | None:
    row = conn.execute("SELECT status FROM ocr_jobs WHERE id = %s", (job_id,)).fetchone()
    if row is None:
        return None
    return OcrJobStatus(str(row[0]))


def _sync_match_draft_status_for_terminal_job(
    conn: psycopg.Connection[TupleRow],
    job_id: str,
) -> None:
    conn.execute(
        """
        WITH touched AS (
          SELECT md.id
          FROM match_drafts md
          JOIN ocr_jobs j ON j.id = %s
          WHERE md.status = 'ocr_running'
            AND j.draft_id IN (
              md.total_assets_draft_id,
              md.revenue_draft_id,
              md.incident_log_draft_id
            )
        ),
        slot_jobs AS (
          SELECT
            md.id AS match_draft_id,
            j.status AS job_status,
            COALESCE(jsonb_array_length(od.warnings_json), 0) AS warning_count
          FROM match_drafts md
          JOIN touched t ON t.id = md.id
          JOIN LATERAL unnest(
            ARRAY[md.total_assets_draft_id, md.revenue_draft_id, md.incident_log_draft_id]
          ) AS slot(ocr_draft_id) ON slot.ocr_draft_id IS NOT NULL
          LEFT JOIN ocr_jobs j ON j.draft_id = slot.ocr_draft_id
          LEFT JOIN ocr_drafts od ON od.id = slot.ocr_draft_id
        ),
        next_status AS (
          SELECT
            match_draft_id,
            CASE
              WHEN COUNT(*) FILTER (
                WHERE job_status IN ('queued', 'running') OR job_status IS NULL
              ) > 0 THEN 'ocr_running'
              WHEN COUNT(*) FILTER (
                WHERE job_status IN ('failed', 'cancelled')
              ) > 0 THEN 'ocr_failed'
              WHEN COUNT(*) FILTER (WHERE warning_count > 0) > 0 THEN 'needs_review'
              ELSE 'draft_ready'
            END AS status
          FROM slot_jobs
          GROUP BY match_draft_id
        )
        UPDATE match_drafts md
        SET status = ns.status, updated_at = now()
        FROM next_status ns
        WHERE md.id = ns.match_draft_id
          AND md.status <> ns.status
        """,
        (job_id,),
    )


def _row_to_record(row: TupleRow | None) -> OcrJobRecord | None:
    if row is None:
        return None
    failure = None
    if row[9] is not None and row[10] is not None and row[11] is not None:
        failure = OcrFailure(
            code=FailureCode(str(row[9])),
            message=str(row[10]),
            retryable=bool(row[11]),
            user_action=None if row[12] is None else str(row[12]),
        )
    return OcrJobRecord(
        job_id=str(row[0]),
        draft_id=str(row[1]),
        image_id=str(row[2]),
        image_path=Path(str(row[3])),
        requested_screen_type=ScreenType(str(row[4])),
        detected_screen_type=None if row[5] is None else ScreenType(str(row[5])),
        status=OcrJobStatus(str(row[6])),
        attempt_count=int(row[7]),
        worker_id=None if row[8] is None else str(row[8]),
        failure=failure,
    )
