package momo.api.repositories.postgres

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*

import momo.api.domain.{OcrDraft, OcrJob}
import momo.api.repositories.{
  OcrJobCreationRepository, OcrJobDraftAttachment, OcrQueueOutboxDraft, OcrQueuePayload,
}

final class PostgresOcrJobCreationRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobCreationRepository[F]:

  override def createQueuedJob(
      draft: OcrDraft,
      job: OcrJob,
      attachment: Option[OcrJobDraftAttachment],
      queuePayload: OcrQueuePayload,
  ): F[Unit] =
    val outbox = OcrQueueOutboxDraft.forJob(job.id, queuePayload, job.createdAt)
    val program = for
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
            else MonadThrow[ConnectionIO].raiseError(
              OcrJobCreationRepository.MatchDraftAttachFailed(a.draftId)
            )
          )
      _ <- PostgresOcrQueueOutbox.insertIntent(outbox)
    yield ()
    program.transact(transactor)
