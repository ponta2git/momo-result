package momo.api.repositories.postgres

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*

import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.repositories.{OcrJobCreationRepository, OcrJobDraftAttachment, OcrQueueOutboxDraft}
import momo.api.domain.{OcrDraft, OcrJob, OcrJobStatus}
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresOcrJobCreationRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobCreationRepository[F]:

  override def createQueuedJob(
      draft: OcrDraft,
      job: OcrJob,
      attachment: Option[OcrJobDraftAttachment],
      enqueueRequest: OcrJobEnqueueRequest,
      activeJobLimit: Int,
  ): F[Unit] =
    val outbox = OcrQueueOutboxDraft.forJob(job.id, enqueueRequest, job.createdAt)
    val program =
      for
        _ <- activeLimitGuard(activeJobLimit)
        _ <- PostgresOcrDrafts.alg.create(draft)
        _ <- PostgresOcrJobs.alg.create(job)
        _ <- attachment match
          case None => MonadThrow[ConnectionIO].unit
          case Some(a) => PostgresMatchDrafts.alg.attachOcrArtifacts(
              draftId = a.draftId,
              screenType = a.screenType,
              sourceImageId = a.sourceImageId,
              ocrDraftId = a.ocrDraftId,
              updatedAt = a.updatedAt,
            ).flatMap(attached =>
              if attached then MonadThrow[ConnectionIO].unit
              else
                MonadThrow[ConnectionIO]
                  .raiseError(OcrJobCreationRepository.MatchDraftAttachFailed(a.draftId))
            )
        _ <- PostgresOcrQueueOutbox.insertIntent(outbox)
      yield ()
    program.transact(transactor)

  private def activeLimitGuard(activeJobLimit: Int): ConnectionIO[Unit] = sql"""
        WITH active_limit_lock AS (
          SELECT pg_advisory_xact_lock(hashtext('momo:ocr_jobs:active_limit')::bigint)
        )
        SELECT COUNT(*)
        FROM ocr_jobs, active_limit_lock
        WHERE status = ${OcrJobStatus.Queued}
           OR status = ${OcrJobStatus.Running}
      """.query[Long].unique.flatMap { active =>
    if active >= activeJobLimit.toLong then
      MonadThrow[ConnectionIO]
        .raiseError(OcrJobCreationRepository.ActiveJobLimitExceeded(activeJobLimit))
    else MonadThrow[ConnectionIO].unit
  }
