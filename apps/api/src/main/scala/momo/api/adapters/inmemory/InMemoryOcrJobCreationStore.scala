package momo.api.adapters.inmemory

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.OcrDraftId
import momo.api.domain.{OcrDraft, OcrJob}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{
  MatchDraftAttachmentResult,
  MatchDraftsRepository,
  OcrDraftsRepository,
  OcrJobCreationPlan,
  OcrJobCreationStore,
  OcrJobDraftAttachment,
  OcrJobsRepository
}

final class InMemoryOcrJobCreationStore[F[_]: MonadThrow](
    drafts: OcrDraftsRepository[F],
    createDraft: OcrDraft => F[Unit],
    jobs: OcrJobsRepository[F],
    createJob: OcrJob => F[Unit],
    matchDrafts: MatchDraftsRepository[F],
    activeJobForDraft: OcrDraftId => F[Boolean],
) extends OcrJobCreationStore[F]:
  override def store(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult] =
    val draft = plan.draft
    val job = plan.job
    val attachment = plan.matchDraftAttachment
    (for
      _ <- EitherT(activeLimitGuard(plan.activeJobLimit))
      _ <- EitherT.liftF(rejectDuplicateOcrRecords(draft, job))
      _ <- attachment match
        case None => EitherT.rightT[F, OcrJobCreationRejection](())
        case Some(a) => EitherT(rejectActiveSlot(a))
      _ <- EitherT(attachMatchDraft(attachment))
      _ <- EitherT.liftF(createDraft(draft))
      _ <- EitherT.liftF(createJob(job))
    yield ()).value

  private def activeLimitGuard(
      activeJobLimit: Int
  ): F[Either[OcrJobCreationRejection, Unit]] = jobs.countActive.map { active =>
    if active >= activeJobLimit.toLong then
      OcrJobCreationRejection.ActiveJobLimitExceeded(activeJobLimit).asLeft
    else ().asRight
  }

  private def attachMatchDraft(
      attachment: Option[OcrJobDraftAttachment]
  ): F[Either[OcrJobCreationRejection, Unit]] = attachment match
    case None => ().asRight[OcrJobCreationRejection].pure[F]
    case Some(a) => matchDrafts.attachOcrArtifacts(
        draftId = a.draftId,
        screenType = a.screenType,
        sourceImageId = a.sourceImageId,
        ocrDraftId = a.ocrDraftId,
        updatedAt = a.updatedAt,
      ).map {
        case MatchDraftAttachmentResult.Attached => ().asRight
        case MatchDraftAttachmentResult.NotAttachable =>
          OcrJobCreationRejection.MatchDraftAttachmentRejected(a.draftId).asLeft
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
  ): F[Either[OcrJobCreationRejection, Unit]] =
    slotHasActiveJob(attachment).map {
      case true => OcrJobCreationRejection.MatchDraftAttachmentRejected(attachment.draftId).asLeft
      case false => ().asRight
    }

  private def slotHasActiveJob(attachment: OcrJobDraftAttachment): F[Boolean] = matchDrafts
    .find(attachment.draftId).flatMap {
      case None => false.pure[F]
      case Some(draft) => draft.ocrDraftId(attachment.screenType)
          .fold(false.pure[F])(activeJobForDraft)
    }
