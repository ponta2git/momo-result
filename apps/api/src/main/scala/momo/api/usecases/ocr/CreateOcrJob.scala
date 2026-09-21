package momo.api.usecases.ocr

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.codec.OcrHintsCodec
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{
  MatchDraftsRepository,
  OcrDraftsRepository,
  OcrJobCreationPlan,
  OcrJobCreationStore,
  OcrJobDraftAttachment,
  OcrJobSubmissionBinding,
  OcrJobsRepository,
  OcrQueueDispatchIntent,
  OcrSubmissionsRepository,
  StoredOcrJob
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class CreateOcrJobCommand(
    imageId: ImageId,
    requestedScreenType: ScreenType,
    submissionId: String,
)

final case class CreatedOcrJob(job: OcrJob, draft: OcrDraft)

final class CreateOcrJob[F[_]: MonadThrow](
    imageStore: ImageStorage[F],
    creationStore: OcrJobCreationStore[F],
    matchDrafts: MatchDraftsRepository[F],
    submissions: OcrSubmissionsRepository[F],
    jobs: OcrJobsRepository[F],
    drafts: OcrDraftsRepository[F],
    queueSubmitter: OcrJobQueueSubmitter[F],
    admissionGuard: OcrAdmissionGuard[F],
    now: F[Instant],
    nextJobId: F[OcrJobId],
    nextDraftId: F[OcrDraftId],
    aliasSnapshot: F[Map[MemberId, List[String]]],
    activeJobLimit: Int,
)(using LoggerFactory[F]):
  import CreateOcrJob.*

  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[CreateOcrJob[F]])

  def run(
      command: CreateOcrJobCommand,
      requestId: Option[String],
      owner: AccountId,
  ): F[Either[AppError, CreatedOcrJob]] =
    submissions.find(command.submissionId, owner).flatMap {
      case None =>
        AppError.NotFound("OCR submission", command.submissionId).asLeft[CreatedOcrJob].pure[F]
      case Some(submission) =>
        submission.members.find(_.screenType == command.requestedScreenType) match
          case None => AppError.Conflict(
              "This image is not a member of the submission."
            ).asLeft[CreatedOcrJob].pure[F]
          case Some(member) => member.jobId match
              case Some(id) => (for
                  job <- jobs.find(id).orNotFound("OCR job", id.value)
                  _ <- EitherT.cond[F](
                    job.imageId == command.imageId,
                    (),
                    AppError.Conflict("This member already has another image.")
                  )
                  draft <- drafts.find(job.draftId).orNotFound("OCR draft", job.draftId.value)
                yield CreatedOcrJob(job, draft)).value
              case None => create(command, requestId, owner, submission, member)
    }

  private def create(
      command: CreateOcrJobCommand,
      requestId: Option[String],
      owner: AccountId,
      submission: OcrSubmission,
      member: OcrSubmissionMember,
  ): F[Either[AppError, CreatedOcrJob]] = (for
    _ <- EitherT.fromEither[F](
      validateNewRequestScreenType(command.requestedScreenType)
    )
    timestamp <- EitherT.liftF(now)
    _ <- EitherT.cond[F](
      submission.status == "open" && member.status == "pending" &&
        timestamp.isBefore(submission.admissionDeadline),
      (),
      AppError.Conflict("This OCR submission is closed. Start a new reading operation.")
    )
    _ <- EitherT.fromEither[F](validateOcrHints(submission.ocrHints))
    _ <- EitherT(admissionGuard.ensureAvailable)
    aliases <- EitherT.liftF(aliasSnapshot)
    enrichedHints = OcrHintEnrichment(submission.ocrHints, aliases)
    _ <- EitherT.fromEither[F](validateOcrHints(enrichedHints))
    draftForMatch <- matchDrafts.find(submission.matchDraftId)
      .orNotFound("match draft", submission.matchDraftId.value).flatMap { draft =>
        if Set(MatchDraftStatus.Confirmed, MatchDraftStatus.Cancelled).contains(draft.status) then
          EitherT.leftT[F, momo.api.domain.MatchDraft](AppError.Conflict(
            s"match draft in status=${draft.status.wire} cannot start OCR."
          ))
        else EitherT.rightT[F, AppError](draft)
      }
    imageId = command.imageId
    image <- imageStore.find(imageId).orNotFound("image", command.imageId.value)
    createdAt <- EitherT.liftF(now)
    jobId <- EitherT.liftF(nextJobId)
    draftId <- EitherT.liftF(nextDraftId)
    draft = initialDraft(draftId, jobId, command.requestedScreenType, createdAt)
    job = queuedJob(jobId, draftId, imageId, image.location, command.requestedScreenType, createdAt)
    enqueueRequest = OcrJobEnqueueRequest.initial(job, image, enrichedHints, requestId)
    attachment = OcrJobDraftAttachment(
      draftId = draftForMatch.id,
      screenType = command.requestedScreenType,
      sourceImageId = command.imageId,
      ocrDraftId = draft.id,
      updatedAt = createdAt,
    )
    queueDispatch = OcrQueueDispatchIntent(
      enqueueRequest = enqueueRequest,
      matchDraftId = submission.matchDraftId,
    )
    creationPlan = OcrJobCreationPlan(
      submission = OcrJobSubmissionBinding(submission.id, owner),
      draft = draft,
      job = job,
      matchDraftAttachment = attachment,
      queueDispatch = queueDispatch,
      activeJobLimit = activeJobLimit,
    )
    stored <- storeDbRecords(creationPlan)
    _ <- if stored.created then EitherT(queueSubmitter.submit(queueDispatch))
    else EitherT.rightT[F, AppError](())
  yield CreatedOcrJob(stored.job, stored.draft)).value

  private def storeDbRecords(
      plan: OcrJobCreationPlan
  ): EitherT[F, AppError, StoredOcrJob] = EitherT(creationStore
    .store(plan)
    .flatMap {
      case Right(stored) => stored.asRight[AppError].pure[F]
      case Left(rejection) => creationRejectionToAppError(rejection)
    })

  private def creationRejectionToAppError(
      rejection: OcrJobCreationRejection
  ): F[Either[AppError, StoredOcrJob]] = rejection match
    case OcrJobCreationRejection.SubmissionRejected => AppError
        .Conflict(
          "This OCR submission member is closed or does not match the image."
        ).asLeft[StoredOcrJob].pure[F]
    case OcrJobCreationRejection.InvalidPlan => AppError
        .Internal("OCR job creation plan is inconsistent.").asLeft[StoredOcrJob].pure[F]
    case OcrJobCreationRejection.ActiveJobLimitExceeded(limit) => logger.warn(
        s"ocr_job_create_rejected reason=active_job_limit_exceeded limit=$limit"
      ) >> AppError.ServiceUnavailable("OCR queue is currently full. Try again later.")
        .asLeft[StoredOcrJob].pure[F]
    case OcrJobCreationRejection.MatchDraftAttachmentRejected(_) => AppError
        .Conflict("match draft could not be attached to the OCR job.").asLeft[StoredOcrJob].pure[F]
    case OcrJobCreationRejection.SourceImageUnavailable(_) => AppError
        .Conflict("source image is no longer available.").asLeft[StoredOcrJob].pure[F]

object CreateOcrJob:
  private def validateNewRequestScreenType(screenType: ScreenType): Either[AppError, Unit] =
    if screenType == ScreenType.Auto then
      Left(AppError.ValidationFailed(
        "requestedScreenType=auto is no longer accepted. Choose an explicit OCR screen type."
      ))
    else Right(())

  private def validateOcrHints(hints: OcrJobHints): Either[AppError, Unit] =
    OcrHintsCodec.validate(hints).left.map(AppError.ValidationFailed.apply)

  private def initialDraft(
      draftId: OcrDraftId,
      jobId: OcrJobId,
      screenType: ScreenType,
      createdAt: Instant,
  ): OcrDraft = OcrDraft(
    id = draftId,
    jobId = jobId,
    requestedScreenType = screenType,
    detectedScreenType = None,
    profileId = None,
    payloadJson = OcrDraftInitialPayloads.payload(screenType),
    warningsJson = OcrDraftInitialPayloads.warnings,
    timingsMsJson = OcrDraftInitialPayloads.timings,
    createdAt = createdAt,
    updatedAt = createdAt,
  )

  private def queuedJob(
      jobId: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imageLocation: StoredImageLocation,
      screenType: ScreenType,
      createdAt: Instant,
  ): OcrJob.Queued = OcrJob.Queued(
    id = jobId,
    draftId = draftId,
    imageId = imageId,
    imageLocation = imageLocation,
    requestedScreenType = screenType,
    attemptCount = 0,
    createdAt = createdAt,
    updatedAt = createdAt,
  )
