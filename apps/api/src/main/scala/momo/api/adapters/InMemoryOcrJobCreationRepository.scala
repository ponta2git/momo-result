package momo.api.adapters

import cats.MonadThrow
import cats.syntax.all.*

import momo.api.domain.ids.OcrDraftId
import momo.api.domain.{OcrDraft, OcrJob}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{
  MatchDraftsRepository, OcrDraftsRepository, OcrJobCreationRepository, OcrJobDraftAttachment,
  OcrJobsRepository, OcrQueuePayload,
}

final class InMemoryOcrJobCreationRepository[F[_]: MonadThrow](
    drafts: OcrDraftsRepository[F],
    jobs: OcrJobsRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    activeJobForDraft: OcrDraftId => F[Boolean],
) extends OcrJobCreationRepository[F]:
  override def createQueuedJob(
      draft: OcrDraft,
      job: OcrJob,
      attachment: Option[OcrJobDraftAttachment],
      queuePayload: OcrQueuePayload,
      activeJobLimit: Int,
  ): F[Unit] =
    val _ = queuePayload
    for
      active <- jobs.countActive
      _ <-
        if active >= activeJobLimit.toLong then
          MonadThrow[F].raiseError(OcrJobCreationRepository.ActiveJobLimitExceeded(activeJobLimit))
        else MonadThrow[F].unit
      _ <- rejectDuplicateOcrRecords(draft, job)
      _ <- attachment.traverse(rejectActiveSlot)
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
      _ <- drafts.create(draft)
      _ <- jobs.create(job)
    yield ()

  private def rejectDuplicateOcrRecords(draft: OcrDraft, job: OcrJob): F[Unit] =
    (drafts.find(draft.id), jobs.find(job.id)).mapN {
      case (Some(_), _) =>
        Some(new AppException(AppError.Conflict(s"ocr draft already exists: ${draft.id.value}")))
      case (_, Some(_)) =>
        Some(new AppException(AppError.Conflict(s"ocr job already exists: ${job.id.value}")))
      case _ => None
    }.flatMap {
      case Some(error) => MonadThrow[F].raiseError(error)
      case None => MonadThrow[F].unit
    }

  private def rejectActiveSlot(attachment: OcrJobDraftAttachment): F[Unit] =
    slotHasActiveJob(attachment).flatMap {
      case true => MonadThrow[F]
          .raiseError(OcrJobCreationRepository.MatchDraftAttachFailed(attachment.draftId))
      case false => MonadThrow[F].unit
    }

  private def slotHasActiveJob(attachment: OcrJobDraftAttachment): F[Boolean] = matchDrafts
    .find(attachment.draftId).flatMap {
      case None => false.pure[F]
      case Some(draft) => draft.ocrDraftId(attachment.screenType)
          .fold(false.pure[F])(activeJobForDraft)
    }
