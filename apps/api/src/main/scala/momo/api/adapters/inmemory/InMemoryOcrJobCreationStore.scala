package momo.api.adapters.inmemory

import cats.MonadThrow
import cats.data.EitherT
import cats.effect.Async
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
  OcrJobsRepository,
  StoredOcrJob
}

final class InMemoryOcrJobCreationStore[F[_]: Async](
    drafts: OcrDraftsRepository[F],
    createDraft: OcrDraft => F[Unit],
    jobs: OcrJobsRepository[F],
    createJob: OcrJob => F[Unit],
    matchDrafts: MatchDraftsRepository[F],
    activeJobForDraft: OcrDraftId => F[Boolean],
    submissions: InMemoryOcrSubmissionsRepository[F],
) extends OcrJobCreationStore[F]:
  override def store(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult] =
    submissions.serialized(storeSerialized(plan))

  private def storeSerialized(plan: OcrJobCreationPlan)
      : F[OcrJobCreationStore.OcrJobCreationResult] =
    submissions.find(plan.submission.submissionId, plan.submission.ownerAccountId).flatMap {
      case None => OcrJobCreationRejection.SubmissionRejected.asLeft[StoredOcrJob].pure[F]
      case Some(submission) =>
        submission.members.find(_.screenType == plan.job.requestedScreenType) match
          case Some(member) if member.jobId.nonEmpty =>
            (for
              job <- EitherT(
                jobs.find(member.jobId.get).map(_.toRight(OcrJobCreationRejection.InvalidPlan))
              )
              draft <- EitherT(
                drafts.find(job.draftId).map(_.toRight(OcrJobCreationRejection.InvalidPlan))
              )
              _ <- EitherT.cond[F](
                job.imageId == plan.job.imageId,
                (),
                OcrJobCreationRejection.SubmissionRejected
              )
            yield StoredOcrJob(job, draft, false)).value
          case Some(member)
              if submission.status == "open" && member.status == "pending" &&
                submission.matchDraftId == plan.matchDraftAttachment.draftId &&
                plan.job.createdAt.isBefore(submission.admissionDeadline) &&
                member.imageSha256 == plan.queueDispatch.enqueueRequest.imageSha256 &&
                member.imageByteLength.toLong ==
                plan.queueDispatch.enqueueRequest.imageByteLength => create(plan)
          case _ => OcrJobCreationRejection.SubmissionRejected.asLeft[StoredOcrJob].pure[F]
    }

  private def create(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult] =
    val draft = plan.draft
    val job = plan.job
    val attachment = plan.matchDraftAttachment
    (for
      _ <- EitherT.cond[F](
        OcrJobCreationPlan.isConsistent(plan),
        (),
        OcrJobCreationRejection.InvalidPlan,
      )
      _ <- EitherT(activeLimitGuard(plan.activeJobLimit))
      _ <- EitherT.liftF(rejectDuplicateOcrRecords(draft, job))
      _ <- EitherT(rejectActiveSlot(attachment))
      _ <- EitherT(attachMatchDraft(attachment))
      _ <- EitherT.liftF(createDraft(draft))
      _ <- EitherT.liftF(createJob(job))
      _ <- EitherT.liftF(submissions.register(
        plan.submission.submissionId,
        job.requestedScreenType,
        job.id
      ))
    yield StoredOcrJob(job, draft, true)).value

  private def activeLimitGuard(
      activeJobLimit: Int
  ): F[Either[OcrJobCreationRejection, Unit]] = jobs.countActive.map { active =>
    if active >= activeJobLimit.toLong then
      OcrJobCreationRejection.ActiveJobLimitExceeded(activeJobLimit).asLeft
    else ().asRight
  }

  private def attachMatchDraft(
      a: OcrJobDraftAttachment
  ): F[Either[OcrJobCreationRejection, Unit]] = matchDrafts.attachOcrArtifacts(
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
