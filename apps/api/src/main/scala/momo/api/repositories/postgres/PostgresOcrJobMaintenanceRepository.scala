package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.{FailureCode, MatchDraftStatus, OcrJobStatus}
import momo.api.repositories.OcrJobMaintenanceRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresOcrJobMaintenanceRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobMaintenanceRepository[F]:

  override def failStaleJobs(now: Instant, staleBefore: Instant): F[Int] =
    val message = "OCR job timed out before completion."
    val userAction = "画像を再アップロードしてOCRをやり直してください。"
    sql"""
      WITH stale AS (
        SELECT id, draft_id
          FROM ocr_jobs
         WHERE status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
           AND COALESCE(started_at, created_at) < $staleBefore
      ),
      updated_jobs AS (
        UPDATE ocr_jobs jobs SET
          status = ${OcrJobStatus.Failed},
          failure_code = ${FailureCode.OcrTimeout},
          failure_message = $message,
          failure_retryable = ${FailureCode.OcrTimeout.retryable},
          failure_user_action = $userAction,
          finished_at = $now,
          updated_at = $now
        FROM stale
        WHERE jobs.id = stale.id
        RETURNING jobs.draft_id, jobs.status
      ),
      touched AS (
        SELECT drafts.id
        FROM match_drafts drafts
        WHERE drafts.status = ${MatchDraftStatus.OcrRunning}
          AND (
            drafts.total_assets_draft_id IN (SELECT draft_id FROM updated_jobs)
            OR drafts.revenue_draft_id IN (SELECT draft_id FROM updated_jobs)
            OR drafts.incident_log_draft_id IN (SELECT draft_id FROM updated_jobs)
          )
      ),
      slot_jobs AS (
        SELECT
          drafts.id AS match_draft_id,
          COALESCE(updated_jobs.status, jobs.status) AS job_status,
          COALESCE(jsonb_array_length(ocr_drafts.warnings_json), 0) AS warning_count
        FROM match_drafts drafts
        JOIN touched ON touched.id = drafts.id
        JOIN LATERAL unnest(
          ARRAY[
            drafts.total_assets_draft_id,
            drafts.revenue_draft_id,
            drafts.incident_log_draft_id
          ]
        ) AS slot(ocr_draft_id) ON slot.ocr_draft_id IS NOT NULL
        LEFT JOIN updated_jobs ON updated_jobs.draft_id = slot.ocr_draft_id
        LEFT JOIN ocr_jobs jobs ON jobs.draft_id = slot.ocr_draft_id
        LEFT JOIN ocr_drafts ON ocr_drafts.id = slot.ocr_draft_id
      ),
      next_status AS (
        SELECT
          match_draft_id,
          CASE
            WHEN COUNT(*) FILTER (
              WHERE job_status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
                 OR job_status IS NULL
            ) > 0 THEN ${MatchDraftStatus.OcrRunning}
            WHEN COUNT(*) FILTER (
              WHERE job_status IN (${OcrJobStatus.Failed}, ${OcrJobStatus.Cancelled})
            ) > 0 THEN ${MatchDraftStatus.OcrFailed}
            WHEN COUNT(*) FILTER (WHERE warning_count > 0) > 0 THEN ${MatchDraftStatus.NeedsReview}
            ELSE ${MatchDraftStatus.DraftReady}
          END AS status
        FROM slot_jobs
        GROUP BY match_draft_id
      ),
      updated_drafts AS (
        UPDATE match_drafts drafts SET
          status = next_status.status,
          updated_at = $now
        FROM next_status
        WHERE drafts.id = next_status.match_draft_id
          AND drafts.status = ${MatchDraftStatus.OcrRunning}
          AND drafts.status <> next_status.status
        RETURNING drafts.id
      )
      SELECT COUNT(*) FROM updated_jobs
    """.query[Int].unique.transact(transactor)
end PostgresOcrJobMaintenanceRepository
