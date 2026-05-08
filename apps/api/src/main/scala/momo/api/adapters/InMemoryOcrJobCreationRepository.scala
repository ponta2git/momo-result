package momo.api.adapters

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.domain.{OcrDraft, OcrJob}
import momo.api.repositories.{
  MatchDraftsRepository, OcrDraftsRepository, OcrJobCreationRepository, OcrJobDraftAttachment,
  OcrJobsRepository, OcrQueuePayload,
}

final class InMemoryOcrJobCreationRepository[F[_]: MonadThrow](
    drafts: OcrDraftsRepository[F],
    jobs: OcrJobsRepository[F],
    matchDrafts: MatchDraftsRepository[F],
) extends OcrJobCreationRepository[F]:
  override def createQueuedJob(
      draft: OcrDraft,
      job: OcrJob,
      attachment: Option[OcrJobDraftAttachment],
      queuePayload: OcrQueuePayload,
  ): F[Unit] =
    val _ = queuePayload
    for
      _ <- drafts.create(draft)
      _ <- jobs.create(job)
      attached <- attachment match
        case None => true.pure[F]
        case Some(a) => matchDrafts.attachOcrArtifacts(
            draftId = a.draftId,
            screenType = a.screenType,
            sourceImageId = a.sourceImageId,
            ocrDraftId = a.ocrDraftId,
            updatedAt = a.updatedAt,
          )
      _ <-
        if attached then MonadThrow[F].unit
        else
          attachment match
            case Some(a) => MonadThrow[F]
                .raiseError(OcrJobCreationRepository.MatchDraftAttachFailed(a.draftId))
            case None => MonadThrow[F].unit
    yield ()
