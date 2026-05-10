package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{
  ImageStore, MatchDraftsRepository, MemberAliasesRepository, OcrJobCreationRepository,
  OcrJobDraftAttachment, OcrQueuePayload,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class CreateOcrJobCommand(
    imageId: ImageId,
    requestedImageType: String,
    ocrHints: OcrJobHints,
    matchDraftId: Option[MatchDraftId],
)

final case class CreatedOcrJob(job: OcrJob, draft: OcrDraft, queuePayload: OcrQueuePayload)

final class CreateOcrJob[F[_]: MonadThrow](
    imageStore: ImageStore[F],
    creation: OcrJobCreationRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    queueSubmitter: OcrQueueSubmitter[F],
    now: F[Instant],
    nextId: F[String],
    requestIdLookup: F[Option[String]],
    memberAliases: MemberAliasesRepository[F],
):
  import CreateOcrJob.*

  def run(command: CreateOcrJobCommand): F[Either[AppError, CreatedOcrJob]] = (for
    screenType <- EitherT.fromEither[F](requestedScreenType(command))
    _ <- EitherT.fromEither[F](validateOcrHints(command.ocrHints))
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
    jobId <- EitherT.liftF(nextId.map(OcrJobId(_)))
    draftId <- EitherT.liftF(nextId.map(OcrDraftId(_)))
    requestId <- EitherT.liftF(requestIdLookup)
    draft = initialDraft(draftId, jobId, screenType, createdAt)
    job = queuedJob(jobId, draftId, imageId, image.path, screenType, createdAt)
    payload = queuePayload(
      jobId,
      draftId,
      imageId,
      image.path,
      screenType,
      createdAt,
      hintsWithAliases,
      requestId,
    )
    attachment = draftForMatch.map(draftRecord =>
      OcrJobDraftAttachment(
        draftId = draftRecord.id,
        screenType = screenType,
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
    creation.createQueuedJob(draft, job, attachment, payload).attempt.flatMap {
      case Right(_) => ().asRight[AppError].pure[F]
      case Left(_: OcrJobCreationRepository.MatchDraftAttachFailed) => AppError
          .Conflict("match draft could not be attached to the OCR job.").asLeft[Unit].pure[F]
      case Left(error) => MonadThrow[F].raiseError[Either[AppError, Unit]](error)
    }
  )

  private def mergeMemberAliases(hints: OcrJobHints): F[OcrJobHints] = memberAliases.list(None)
    .map { rows =>
      if rows.isEmpty then hints
      else
        val byMember = rows.groupMap(_.memberId.value)(_.alias)
        val requestedIds = hints.knownPlayerAliases.map(_.memberId)
        val dbOnlyIds = byMember.keys.toList.sorted.filterNot(requestedIds.contains)
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
  private def requestedScreenType(command: CreateOcrJobCommand): Either[AppError, ScreenType] =
    ScreenType.fromWire(command.requestedImageType).toRight(AppError.ValidationFailed(
      "requestedImageType must be auto, total_assets, revenue, or incident_log."
    ))

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
