from __future__ import annotations

from dataclasses import dataclass

import psycopg
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


def persist_result_record(
    conn: psycopg.Connection[object],
    record: OcrResultRecord,
) -> None:
    detected_screen_type = (
        record.payload.detected_screen_type.value
        if record.payload.detected_screen_type is not None
        else None
    )
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
