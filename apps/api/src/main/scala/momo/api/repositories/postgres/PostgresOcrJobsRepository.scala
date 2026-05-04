package momo.api.repositories.postgres

import java.nio.file.Path
import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ids.*
import momo.api.domain.{FailureCode, OcrFailure, OcrJob, OcrJobStatus, ScreenType}
import momo.api.repositories.OcrJobsRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresOcrJobsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobsRepository[F]:

  private type Row = (
      OcrJobId,
      OcrDraftId,
      ImageId,
      Path,
      ScreenType,
      Option[ScreenType],
      OcrJobStatus,
      Int,
      Option[String],
      Option[FailureCode],
      Option[String],
      Option[Boolean],
      Option[String],
      Option[Instant],
      Option[Instant],
      Option[Int],
      Instant,
      Instant,
  )

  private def toJob(r: Row): OcrJob =
    val failure = (r._10, r._11, r._12) match
      case (Some(code), Some(msg), Some(retry)) => Some(OcrFailure(code, msg, retry, r._13))
      case _ => None
    OcrJob(
      id = r._1,
      draftId = r._2,
      imageId = r._3,
      imagePath = r._4,
      requestedScreenType = r._5,
      detectedScreenType = r._6,
      status = r._7,
      attemptCount = r._8,
      workerId = r._9,
      failure = failure,
      startedAt = r._14,
      finishedAt = r._15,
      durationMs = r._16,
      createdAt = r._17,
      updatedAt = r._18,
    )

  private val selectAll = fr"""SELECT
           id, draft_id, image_id, image_path,
           requested_screen_type, detected_screen_type,
           status, attempt_count, worker_id,
           failure_code, failure_message, failure_retryable, failure_user_action,
           started_at, finished_at, duration_ms,
           created_at, updated_at
         FROM ocr_jobs"""

  override def create(job: OcrJob): F[Unit] = sql"""
      INSERT INTO ocr_jobs (
        id, draft_id, image_id, image_path,
        requested_screen_type, detected_screen_type,
        status, attempt_count, worker_id,
        failure_code, failure_message, failure_retryable, failure_user_action,
        started_at, finished_at, duration_ms,
        created_at, updated_at
      ) VALUES (
        ${job.id}, ${job.draftId}, ${job.imageId}, ${job.imagePath},
        ${job.requestedScreenType}, ${job.detectedScreenType},
        ${job.status}, ${job.attemptCount}, ${job.workerId},
        ${job.failure.map(_.code)}, ${job.failure.map(_.message)},
        ${job.failure.map(_.retryable)}, ${job.failure.flatMap(_.userAction)},
        ${job.startedAt}, ${job.finishedAt}, ${job.durationMs},
        ${job.createdAt}, ${job.updatedAt}
      )
    """.update.run.void.transact(transactor)

  override def find(jobId: OcrJobId): F[Option[OcrJob]] = (selectAll ++ fr"WHERE id = $jobId")
    .query[Row].option.map(_.map(toJob)).transact(transactor)

  override def markFailed(jobId: OcrJobId, failure: OcrFailure, now: Instant): F[Unit] = sql"""
      UPDATE ocr_jobs SET
        status = ${OcrJobStatus.Failed},
        failure_code = ${failure.code},
        failure_message = ${failure.message},
        failure_retryable = ${failure.retryable},
        failure_user_action = ${failure.userAction},
        finished_at = $now,
        updated_at = $now
      WHERE id = $jobId
    """.update.run.void.transact(transactor)

  override def cancelQueued(jobId: OcrJobId, now: Instant): F[Boolean] = sql"""
      UPDATE ocr_jobs SET
        status = ${OcrJobStatus.Cancelled},
        finished_at = $now,
        updated_at = $now
      WHERE id = $jobId AND status = ${OcrJobStatus.Queued}
    """.update.run.map(_ > 0).transact(transactor)
