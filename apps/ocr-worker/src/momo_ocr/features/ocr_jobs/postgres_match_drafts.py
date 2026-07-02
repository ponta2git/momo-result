from __future__ import annotations

import psycopg
from psycopg.rows import TupleRow


def sync_match_draft_status_for_terminal_job(
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
          AND md.status NOT IN ('confirmed', 'cancelled')
          AND md.status <> ns.status
        """,
        (job_id,),
    )
