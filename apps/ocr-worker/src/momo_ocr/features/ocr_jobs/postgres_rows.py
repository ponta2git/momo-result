from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import psycopg
from psycopg.rows import TupleRow

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobRecord, OcrJobStatus
from momo_ocr.shared.errors import FailureCode, OcrFailure

SELECT_JOB = """
    SELECT
      id, draft_id, image_id, image_path,
      requested_screen_type, detected_screen_type,
      status, attempt_count, worker_id,
      failure_code, failure_message, failure_retryable, failure_user_action
    FROM ocr_jobs
    WHERE id = %s
"""


@dataclass(frozen=True)
class OcrJobRow:
    id: str
    draft_id: str
    image_id: str
    image_path: str
    requested_screen_type: str
    detected_screen_type: str | None
    status: str
    attempt_count: int
    worker_id: str | None
    failure_code: str | None
    failure_message: str | None
    failure_retryable: bool | None
    failure_user_action: str | None


def select_status(conn: psycopg.Connection[TupleRow], job_id: str) -> OcrJobStatus | None:
    row = conn.execute("SELECT status FROM ocr_jobs WHERE id = %s", (job_id,)).fetchone()
    if row is None:
        return None
    return OcrJobStatus(str(row[0]))


def row_to_record(row: TupleRow | None) -> OcrJobRecord | None:
    if row is None:
        return None
    return row_data_to_record(_row_data(row))


def row_data_to_record(row: OcrJobRow) -> OcrJobRecord:
    return OcrJobRecord(
        job_id=row.id,
        draft_id=row.draft_id,
        image_id=row.image_id,
        image_path=Path(row.image_path),
        requested_screen_type=ScreenType(row.requested_screen_type),
        detected_screen_type=(
            None if row.detected_screen_type is None else ScreenType(row.detected_screen_type)
        ),
        status=OcrJobStatus(row.status),
        attempt_count=row.attempt_count,
        worker_id=row.worker_id,
        failure=_failure_from_row(row),
    )


def _row_data(row: TupleRow) -> OcrJobRow:
    return OcrJobRow(
        id=str(row[0]),
        draft_id=str(row[1]),
        image_id=str(row[2]),
        image_path=str(row[3]),
        requested_screen_type=str(row[4]),
        detected_screen_type=None if row[5] is None else str(row[5]),
        status=str(row[6]),
        attempt_count=int(row[7]),
        worker_id=None if row[8] is None else str(row[8]),
        failure_code=None if row[9] is None else str(row[9]),
        failure_message=None if row[10] is None else str(row[10]),
        failure_retryable=None if row[11] is None else bool(row[11]),
        failure_user_action=None if row[12] is None else str(row[12]),
    )


def _failure_from_row(row: OcrJobRow) -> OcrFailure | None:
    if row.failure_code is None or row.failure_message is None or row.failure_retryable is None:
        return None
    return OcrFailure(
        code=FailureCode(row.failure_code),
        message=row.failure_message,
        retryable=row.failure_retryable,
        user_action=row.failure_user_action,
    )
