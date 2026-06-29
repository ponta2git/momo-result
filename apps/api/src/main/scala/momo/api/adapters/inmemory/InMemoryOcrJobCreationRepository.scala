package momo.api.adapters.inmemory

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.OcrDraftId
import momo.api.domain.{OcrDraft, OcrJob}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.repositories.OcrJobCreationRepository.CreateQueuedJobRejection
import momo.api.repositories.{
  MatchDraftsRepository,
  OcrDraftsRepository,
  OcrJobCreationRepository,
  OcrJobDraftAttachment,
  OcrJobsRepository
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
      enqueueRequest: OcrJobEnqueueRequest,
      activeJobLimit: Int,
  ): F[OcrJobCreationRepository.CreateQueuedJobResult] =
    val _ = enqueueRequest
    (for
      _ <- EitherT(activeLimitGuard(activeJobLimit))
      _ <- EitherT.liftF(rejectDuplicateOcrRecords(draft, job))
      _ <- attachment match
        case None => EitherT.rightT[F, CreateQueuedJobRejection](())
        case Some(a) => EitherT(rejectActiveSlot(a))
      _ <- EitherT(attachMatchDraft(attachment))
      _ <- EitherT.liftF(drafts.create(draft))
      _ <- EitherT.liftF(jobs.create(job))
    yield ()).value

  private def activeLimitGuard(
      activeJobLimit: Int
  ): F[Either[CreateQueuedJobRejection, Unit]] = jobs.countActive.map { active =>
    if active >= activeJobLimit.toLong then
      CreateQueuedJobRejection.ActiveJobLimitExceeded(activeJobLimit).asLeft
    else ().asRight
  }

  private def attachMatchDraft(
      attachment: Option[OcrJobDraftAttachment]
  ): F[Either[CreateQueuedJobRejection, Unit]] = attachment match
    case None => ().asRight[CreateQueuedJobRejection].pure[F]
    case Some(a) => matchDrafts.attachOcrArtifacts(
        draftId = a.draftId,
        screenType = a.screenType,
        sourceImageId = a.sourceImageId,
        ocrDraftId = a.ocrDraftId,
        updatedAt = a.updatedAt,
      ).map {
        case true => ().asRight
        case false => CreateQueuedJobRejection.MatchDraftAttachFailed(a.draftId).asLeft
      }

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

  private def rejectActiveSlot(
      attachment: OcrJobDraftAttachment
  ): F[Either[CreateQueuedJobRejection, Unit]] =
    slotHasActiveJob(attachment).map {
      case true => CreateQueuedJobRejection.MatchDraftAttachFailed(attachment.draftId).asLeft
      case false => ().asRight
    }

  private def slotHasActiveJob(attachment: OcrJobDraftAttachment): F[Boolean] = matchDrafts
    .find(attachment.draftId).flatMap {
      case None => false.pure[F]
      case Some(draft) => draft.ocrDraftId(attachment.screenType)
          .fold(false.pure[F])(activeJobForDraft)
    }
