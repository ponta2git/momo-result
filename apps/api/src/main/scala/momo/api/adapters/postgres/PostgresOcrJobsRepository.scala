package momo.api.adapters.postgres
import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{
  FailureCode,
  OcrFailure,
  OcrJob,
  OcrJobStatus,
  ScreenType,
  StoredImageLocation
}
import momo.api.repositories.{OcrJobsAlg, OcrJobsRepository}

object PostgresOcrJobs:

  private final case class Row(
      id: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imageLocation: StoredImageLocation,
      requestedScreenType: ScreenType,
      detectedScreenType: Option[ScreenType],
      status: OcrJobStatus,
      attemptCount: Int,
      workerId: Option[String],
      failureCode: Option[FailureCode],
      failureMessage: Option[String],
      failureRetryable: Option[Boolean],
      failureUserAction: Option[String],
      startedAt: Option[Instant],
      finishedAt: Option[Instant],
      durationMs: Option[Int],
      createdAt: Instant,
      updatedAt: Instant,
  )

  private def toJob(r: Row): ConnectionIO[OcrJob] =
    val failure = (r.failureCode, r.failureMessage, r.failureRetryable) match
      case (Some(code), Some(msg), Some(retry)) =>
        Some(OcrFailure(code, msg, retry, r.failureUserAction))
      case _ => None

    def inconsistent(reason: String): ConnectionIO[OcrJob] = cats.MonadThrow[ConnectionIO]
      .raiseError(PostgresDataIntegrityException.inconsistentRow("ocr_jobs", r.id.value, reason))

    r.status match
      case OcrJobStatus.Queued => OcrJob.Queued(
          r.id,
          r.draftId,
          r.imageId,
          r.imageLocation,
          r.requestedScreenType,
          r.attemptCount,
          r.createdAt,
          r.updatedAt,
        ).pure[ConnectionIO].widen[OcrJob]
      case OcrJobStatus.Running => (r.workerId, r.startedAt) match
          case (Some(w), Some(s)) => OcrJob.Running(
              r.id,
              r.draftId,
              r.imageId,
              r.imageLocation,
              r.requestedScreenType,
              r.attemptCount,
              w,
              s,
              r.createdAt,
              r.updatedAt,
            ).pure[ConnectionIO].widen[OcrJob]
          case _ => inconsistent("status=running requires worker_id and started_at")
      case OcrJobStatus.Succeeded =>
        (r.detectedScreenType, r.startedAt, r.finishedAt, r.durationMs) match
          case (Some(d), Some(s), Some(f), Some(dm)) => OcrJob.Succeeded(
              r.id,
              r.draftId,
              r.imageId,
              r.imageLocation,
              r.requestedScreenType,
              d,
              r.attemptCount,
              r.workerId,
              s,
              f,
              dm,
              r.createdAt,
              r.updatedAt,
            ).pure[ConnectionIO].widen[OcrJob]
          case _ => inconsistent(
              "status=succeeded requires detected_screen_type, started_at, finished_at, duration_ms"
            )
      case OcrJobStatus.Failed => (failure, r.finishedAt) match
          case (Some(f), Some(fin)) => OcrJob.Failed(
              r.id,
              r.draftId,
              r.imageId,
              r.imageLocation,
              r.requestedScreenType,
              r.detectedScreenType,
              r.attemptCount,
              r.workerId,
              f,
              r.startedAt,
              fin,
              r.durationMs,
              r.createdAt,
              r.updatedAt,
            ).pure[ConnectionIO].widen[OcrJob]
          case _ => inconsistent("status=failed requires failure_* columns and finished_at")
      case OcrJobStatus.Cancelled => r.finishedAt match
          case Some(f) => OcrJob.Cancelled(
              r.id,
              r.draftId,
              r.imageId,
              r.imageLocation,
              r.requestedScreenType,
              r.attemptCount,
              f,
              r.createdAt,
              r.updatedAt,
            ).pure[ConnectionIO].widen[OcrJob]
          case None => inconsistent("status=cancelled requires finished_at")

  private val selectAll = fr"""SELECT
           id, draft_id, image_id, image_path,
           requested_screen_type, detected_screen_type,
           status, attempt_count, worker_id,
           failure_code, failure_message, failure_retryable, failure_user_action,
           started_at, finished_at, duration_ms,
           created_at, updated_at
         FROM ocr_jobs"""

  def createV2(job: OcrJob): ConnectionIO[Unit] = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, image_path, source_image_id, queue_schema_version,
        requested_screen_type, detected_screen_type,
        status, attempt_count, worker_id,
        failure_code, failure_message, failure_retryable, failure_user_action,
        started_at, finished_at, duration_ms,
        created_at, updated_at
      ) VALUES (
        ${job.id}, ${job.draftId}, ${job.imageId}, ${job.imageLocation}, ${job.imageId}, 2,
        ${job.requestedScreenType}, ${OcrJob.detectedScreenType(job)},
        ${job.status}, ${job.attemptCount}, ${OcrJob.workerId(job)},
        ${OcrJob.failure(job).map(_.code)}, ${OcrJob.failure(job).map(_.message)},
        ${OcrJob.failure(job).map(_.retryable)}, ${OcrJob.failure(job).flatMap(_.userAction)},
        ${OcrJob.startedAt(job)}, ${OcrJob.finishedAt(job)}, ${OcrJob.durationMs(job)},
        ${job.createdAt}, ${job.updatedAt}
      )
    """.update.run.void

  val alg: OcrJobsAlg[ConnectionIO] = new OcrJobsAlg[ConnectionIO]:
    override def find(jobId: OcrJobId): ConnectionIO[Option[OcrJob]] =
      (selectAll ++ fr"WHERE id = $jobId").query[Row].option.flatMap {
        case None => Option.empty[OcrJob].pure[ConnectionIO]
        case Some(row) => toJob(row).map(Some(_))
      }

    override def countActive: ConnectionIO[Long] = sql"""
        SELECT COUNT(*)
        FROM ocr_jobs
        WHERE status = ${OcrJobStatus.Queued}
           OR status = ${OcrJobStatus.Running}
      """.query[Long].unique

    override def markFailed(
        jobId: OcrJobId,
        failure: OcrFailure,
        now: Instant,
    ): ConnectionIO[Unit] =
      PostgresMatchDraftStatusSync.lockForJob(jobId) >> sql"""
        UPDATE ocr_jobs SET
          status = ${OcrJobStatus.Failed},
          failure_code = ${failure.code},
          failure_message = ${failure.message},
          failure_retryable = ${failure.retryable},
          failure_user_action = ${failure.userAction},
          finished_at = $now,
          updated_at = $now
        WHERE id = $jobId
      """.update.run.void >> PostgresMatchDraftStatusSync.recomputeForJob(jobId, now)

    override def cancelQueued(jobId: OcrJobId, now: Instant): ConnectionIO[Boolean] =
      for
        _ <- PostgresMatchDraftStatusSync.lockForJob(jobId)
        updated <- sql"""
        UPDATE ocr_jobs SET
          status = ${OcrJobStatus.Cancelled},
          finished_at = $now,
          updated_at = $now
        WHERE id = $jobId AND status = ${OcrJobStatus.Queued}
      """.update.run
        _ <-
          if updated == 1 then PostgresMatchDraftStatusSync.recomputeForJob(jobId, now)
          else ().pure[ConnectionIO]
      yield updated == 1

    override def cancelQueuedByDraftIds(
        draftIds: List[OcrDraftId],
        now: Instant,
    ): ConnectionIO[Int] =
      if draftIds.isEmpty then 0.pure[ConnectionIO]
      else
        val ids = draftIds.map(_.value).toArray
        for
          _ <- PostgresMatchDraftStatusSync.lockForDrafts(draftIds)
          cancelledDraftIds <- sql"""
            WITH candidates AS (
              SELECT id
              FROM ocr_jobs
              WHERE draft_id = ANY($ids)
                AND status = ${OcrJobStatus.Queued}
              ORDER BY id
              FOR UPDATE
            )
            UPDATE ocr_jobs jobs SET
              status = ${OcrJobStatus.Cancelled},
              finished_at = $now,
              updated_at = $now
            FROM candidates
            WHERE jobs.id = candidates.id
              AND jobs.status = ${OcrJobStatus.Queued}
            RETURNING jobs.draft_id
          """.query[OcrDraftId].to[List]
          _ <- PostgresMatchDraftStatusSync.recomputeForDrafts(cancelledDraftIds, now)
        yield cancelledDraftIds.size
end PostgresOcrJobs

/** Backwards-compatible class facade. */
final class PostgresOcrJobsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobsRepository[F]:
  private val delegate: OcrJobsRepository[F] = OcrJobsRepository
    .fromAlg(PostgresOcrJobs.alg, Database.transactK(transactor))

  export delegate.*
end PostgresOcrJobsRepository
