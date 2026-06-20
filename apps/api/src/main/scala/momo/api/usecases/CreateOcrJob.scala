package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{
  ImageStore,
  MatchDraftsRepository,
  MemberAliasesRepository,
  OcrJobCreationRepository,
  OcrJobDraftAttachment,
  OcrQueuePayload
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class CreateOcrJobCommand(
    imageId: ImageId,
    requestedScreenType: ScreenType,
    ocrHints: OcrJobHints,
    matchDraftId: Option[MatchDraftId],
)

final case class CreatedOcrJob(job: OcrJob, draft: OcrDraft, queuePayload: OcrQueuePayload)

final class CreateOcrJob[F[_]: MonadThrow](
    imageStore: ImageStore[F],
    creation: OcrJobCreationRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    queueSubmitter: OcrQueueSubmitter[F],
    admissionGuard: OcrAdmissionGuard[F],
    now: F[Instant],
    nextJobId: F[OcrJobId],
    nextDraftId: F[OcrDraftId],
    memberAliases: MemberAliasesRepository[F],
    activeJobLimit: Int,
)(using LoggerFactory[F]):
  import CreateOcrJob.*

  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[CreateOcrJob[F]])

  def run(
      command: CreateOcrJobCommand,
      requestId: Option[String],
  ): F[Either[AppError, CreatedOcrJob]] = (for
    _ <- EitherT.fromEither[F](
      validateMatchDraftScreenType(command.requestedScreenType, command.matchDraftId)
    )
    _ <- EitherT.fromEither[F](validateOcrHints(command.ocrHints))
    _ <- EitherT(admissionGuard.ensureAvailable)
    hintsWithAliases <- EitherT.liftF(mergeMemberAliases(command.ocrHints))
    draftForMatch <- command.matchDraftId match
      case None => EitherT.rightT[F, AppError](Option.empty[momo.api.domain.MatchDraft])
      case Some(id) => matchDrafts.find(id).orNotFound("match draft", id.value).flatMap { draft =>
          if Set(MatchDraftStatus.Confirmed, MatchDraftStatus.Cancelled).contains(draft.status) then
            EitherT.leftT[F, Option[momo.api.domain.MatchDraft]](AppError.Conflict(
              s"match draft in status=${draft.status.wire} cannot start OCR."
            ))
          else EitherT.rightT[F, AppError](Some(draft))
        }
    imageId = command.imageId
    image <- imageStore.find(imageId).orNotFound("image", command.imageId.value)
    createdAt <- EitherT.liftF(now)
    jobId <- EitherT.liftF(nextJobId)
    draftId <- EitherT.liftF(nextDraftId)
    draft = initialDraft(draftId, jobId, command.requestedScreenType, createdAt)
    job = queuedJob(jobId, draftId, imageId, image.path, command.requestedScreenType, createdAt)
    payload = queuePayload(
      jobId,
      draftId,
      imageId,
      image.path,
      command.requestedScreenType,
      createdAt,
      hintsWithAliases,
      requestId,
    )
    attachment = draftForMatch.map(draftRecord =>
      OcrJobDraftAttachment(
        draftId = draftRecord.id,
        screenType = command.requestedScreenType,
        sourceImageId = command.imageId,
        ocrDraftId = draft.id,
        updatedAt = createdAt,
      )
    )
    _ <- createDbRecords(draft, job, attachment, payload)
    _ <- EitherT(queueSubmitter.submit(OcrQueueSubmitter.Context(
      payload = payload,
      jobId = jobId,
      draftId = draftId,
      matchDraftId = command.matchDraftId,
      createdAt = createdAt,
    )))
  yield CreatedOcrJob(job, draft, payload)).value

  private def createDbRecords(
      draft: OcrDraft,
      job: OcrJob,
      attachment: Option[OcrJobDraftAttachment],
      payload: OcrQueuePayload,
  ): EitherT[F, AppError, Unit] = EitherT(
    creation.createQueuedJob(draft, job, attachment, payload, activeJobLimit).attempt.flatMap {
      case Right(_) => ().asRight[AppError].pure[F]
      case Left(_: OcrJobCreationRepository.ActiveJobLimitExceeded) => logger.warn(
          s"ocr_job_create_rejected reason=active_job_limit_exceeded limit=$activeJobLimit"
        ) >> AppError.ServiceUnavailable("OCR queue is currently full. Try again later.")
          .asLeft[Unit].pure[F]
      case Left(_: OcrJobCreationRepository.MatchDraftAttachFailed) => AppError
          .Conflict("match draft could not be attached to the OCR job.").asLeft[Unit].pure[F]
      case Left(error) => MonadThrow[F].raiseError[Either[AppError, Unit]](error)
    }
  )

  private def mergeMemberAliases(hints: OcrJobHints): F[OcrJobHints] = memberAliases.list(None)
    .map { rows =>
      if rows.isEmpty then hints
      else
        val byMember = rows.groupMap(_.memberId)(_.alias)
        val requestedIds = hints.knownPlayerAliases.map(_.memberId)
        val dbOnlyIds = byMember.keys.toList.sortBy(_.value).filterNot(requestedIds.contains)
        val memberIds = (requestedIds ++ dbOnlyIds).distinct.take(OcrJobHints.MaxKnownPlayerAliases)
        val mergedAliases = memberIds.flatMap { memberId =>
          val clientAliases = hints.knownPlayerAliases.find(_.memberId == memberId)
            .fold(Nil)(_.aliases)
          val aliases = (clientAliases ++ byMember.getOrElse(memberId, Nil)).map(_.trim)
            .filter(_.nonEmpty).distinct.take(OcrJobHints.MaxAliasesPerPlayer)
          Option.when(aliases.nonEmpty)(PlayerAliasHint(memberId, aliases))
        }
        hints.copy(knownPlayerAliases = mergedAliases)
    }

object CreateOcrJob:
  private def validateMatchDraftScreenType(
      screenType: ScreenType,
      matchDraftId: Option[MatchDraftId],
  ): Either[AppError, Unit] =
    if screenType == ScreenType.Auto && matchDraftId.nonEmpty then
      Left(AppError.ValidationFailed(
        "requestedScreenType=auto cannot be attached to an existing match draft."
      ))
    else Right(())

  private def validateOcrHints(hints: OcrJobHints): Either[AppError, Unit] = OcrJobHints
    .validationErrors(hints) match
    case Nil => Right(())
    case errors => Left(AppError.ValidationFailed(errors.mkString(" ")))

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
      imagePath: java.nio.file.Path,
      screenType: ScreenType,
      createdAt: Instant,
  ): OcrJob = OcrJob.Queued(
    id = jobId,
    draftId = draftId,
    imageId = imageId,
    imagePath = imagePath,
    requestedScreenType = screenType,
    attemptCount = 0,
    createdAt = createdAt,
    updatedAt = createdAt,
  )

  private def queuePayload(
      jobId: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imagePath: java.nio.file.Path,
      screenType: ScreenType,
      enqueuedAt: Instant,
      hints: OcrJobHints,
      requestId: Option[String],
  ): OcrQueuePayload = OcrQueuePayload.build(
    jobId = jobId,
    draftId = draftId,
    imageId = imageId,
    imagePath = imagePath,
    requestedScreenType = screenType,
    attempt = 1,
    enqueuedAt = enqueuedAt,
    hints = hints,
    requestId = requestId,
  )
