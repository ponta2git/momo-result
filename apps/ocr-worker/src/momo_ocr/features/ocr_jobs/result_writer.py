from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Protocol

import psycopg
from psycopg.rows import TupleRow
from psycopg.types.json import Jsonb

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning
from momo_ocr.shared.json import to_jsonable


@dataclass(frozen=True)
class OcrResultRecord:
    job_id: str
    draft_id: str
    payload: OcrDraftPayload
    warnings: tuple[OcrWarning, ...]
    timings_ms: dict[str, float]


class OcrResultWriter(Protocol):
    """Persists a successful OCR draft for a given job.

    The writer is invoked exactly once per job before the queue is acked. It
    must be idempotent on ``job_id``: a successful retry of the same job (e.g.
    after a worker crash before ack) must not produce duplicate drafts.
    """

    def persist(self, record: OcrResultRecord) -> None:
        raise NotImplementedError


@dataclass
class InMemoryOcrResultWriter:
    """Test double implementing :class:`OcrResultWriter`.

    Records writes keyed by ``job_id`` so tests can assert that each job
    persists at most one draft, regardless of redeliveries.
    """

    records: dict[str, OcrResultRecord] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)

    def persist(self, record: OcrResultRecord) -> None:
        with self._lock:
            self.records[record.job_id] = record


class PostgresOcrResultWriter:
    def __init__(self, conninfo: str) -> None:
        self._conninfo = conninfo

    def persist(self, record: OcrResultRecord) -> None:
        detected_screen_type = (
            record.payload.detected_screen_type.value
            if record.payload.detected_screen_type is not None
            else None
        )
        with self._connect() as conn, conn.transaction():
            conn.execute(
                """
                INSERT INTO ocr_drafts (
                  id, job_id,
                  requested_screen_type, detected_screen_type, profile_id,
                  payload_json, warnings_json, timings_ms_json,
                  created_at, updated_at
                ) VALUES (
                  %s, %s,
                  %s, %s, %s,
                  %s, %s, %s,
                  now(), now()
                )
                ON CONFLICT (job_id) DO UPDATE SET
                  id = EXCLUDED.id,
                  requested_screen_type = EXCLUDED.requested_screen_type,
                  detected_screen_type = EXCLUDED.detected_screen_type,
                  profile_id = EXCLUDED.profile_id,
                  payload_json = EXCLUDED.payload_json,
                  warnings_json = EXCLUDED.warnings_json,
                  timings_ms_json = EXCLUDED.timings_ms_json,
                  updated_at = now()
                """,
                (
                    record.draft_id,
                    record.job_id,
                    record.payload.requested_screen_type.value,
                    detected_screen_type,
                    record.payload.profile_id,
                    Jsonb(to_jsonable(record.payload)),
                    Jsonb(to_jsonable(list(record.warnings))),
                    Jsonb(to_jsonable(record.timings_ms)),
                ),
            )

    def _connect(self) -> psycopg.Connection[TupleRow]:
        return psycopg.connect(self._conninfo)
