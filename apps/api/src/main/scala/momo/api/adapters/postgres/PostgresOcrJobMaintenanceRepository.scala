package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{MatchDraftId, OcrDraftId, OcrJobId}
import momo.api.domain.{FailureCode, MatchDraftStatus, OcrJobStatus}
import momo.api.repositories.OcrJobMaintenanceRepository

final class PostgresOcrJobMaintenanceRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobMaintenanceRepository[F]:
  private final case class StaleJobCandidateRow(jobId: OcrJobId, draftId: OcrDraftId)

  private val batchSize = 256

  override def failStaleJobs(now: Instant, staleBefore: Instant): F[Int] =
    val message = "OCR job timed out before completion."
    val userAction = "画像を再アップロードしてOCRをやり直してください。"

    def selectCandidates: ConnectionIO[List[StaleJobCandidateRow]] = sql"""
      SELECT id, draft_id
      FROM ocr_jobs
      WHERE status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
        AND COALESCE(started_at, created_at) < $staleBefore
      ORDER BY id
      LIMIT $batchSize
    """.query[StaleJobCandidateRow].to[List]

    def failBatch(jobIds: List[OcrJobId]): ConnectionIO[List[OcrDraftId]] =
      val ids = jobIds.map(_.value).toArray
      sql"""
      WITH stale AS (
        SELECT id
        FROM ocr_jobs
        WHERE id = ANY($ids)
          AND status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
          AND COALESCE(started_at, created_at) < $staleBefore
        ORDER BY id
        FOR UPDATE
      )
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
        AND jobs.status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
      RETURNING jobs.draft_id
    """.query[OcrDraftId].to[List]

    val runBatch = (for
      candidates <- selectCandidates
      candidateDraftIds = candidates.map(_.draftId)
      _ <- PostgresMatchDraftStatusSync.lockForDrafts(candidateDraftIds)
      updatedDraftIds <- failBatch(candidates.map(_.jobId))
      _ <- PostgresMatchDraftStatusSync.recomputeForDrafts(updatedDraftIds, now)
    yield candidates.size -> updatedDraftIds.size).transact(transactor)

    val failAll = cats.Monad[F].tailRecM(0) { total =>
      runBatch.map { case (candidateCount, updatedCount) =>
        val nextTotal = total + updatedCount
        if candidateCount < batchSize then Right(nextTotal)
        else Left(nextTotal)
      }
    }

    def selectTerminalDrafts: ConnectionIO[List[MatchDraftId]] = sql"""
      SELECT md.id
      FROM match_drafts md
      WHERE md.status = ${MatchDraftStatus.OcrRunning}
        AND COALESCE(
          md.total_assets_draft_id,
          md.revenue_draft_id,
          md.incident_log_draft_id
        ) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            md.total_assets_draft_id,
            md.revenue_draft_id,
            md.incident_log_draft_id
          ]) AS slot(ocr_draft_id)
          LEFT JOIN ocr_jobs job ON job.draft_id = slot.ocr_draft_id
          WHERE slot.ocr_draft_id IS NOT NULL
            AND (
              job.status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
              OR job.status IS NULL
            )
        )
      ORDER BY md.id
      LIMIT $batchSize
      FOR UPDATE OF md
    """.query[MatchDraftId].to[List]

    val reconcileBatch = (for
      draftIds <- selectTerminalDrafts
      _ <- PostgresMatchDraftStatusSync.recomputeMatchDrafts(draftIds, now)
    yield draftIds.size).transact(transactor)

    val reconcileAll = cats.Monad[F].tailRecM(()) { _ =>
      reconcileBatch.map(reconciled =>
        if reconciled < batchSize then Right(())
        else Left(())
      )
    }

    failAll.flatTap(_ => reconcileAll)
end PostgresOcrJobMaintenanceRepository
