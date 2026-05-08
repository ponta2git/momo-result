package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.{FailureCode, MatchDraftStatus, OcrJobStatus}
import momo.api.repositories.OcrJobMaintenanceRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresOcrJobMaintenanceRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends OcrJobMaintenanceRepository[F]:

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
        RETURNING jobs.draft_id
      ),
      updated_drafts AS (
        UPDATE match_drafts drafts SET
          status = ${MatchDraftStatus.OcrFailed},
          updated_at = $now
        WHERE drafts.status = ${MatchDraftStatus.OcrRunning}
          AND (
            drafts.total_assets_draft_id IN (SELECT draft_id FROM updated_jobs)
            OR drafts.revenue_draft_id IN (SELECT draft_id FROM updated_jobs)
            OR drafts.incident_log_draft_id IN (SELECT draft_id FROM updated_jobs)
          )
        RETURNING drafts.id
      )
      SELECT COUNT(*) FROM updated_jobs
    """.query[Int].unique.transact(transactor)
end PostgresOcrJobMaintenanceRepository
