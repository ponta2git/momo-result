package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*
import io.circe.Json

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{
  ImageStore, MatchDraftsRepository, OcrDraftsRepository, OcrJobsRepository, OcrQueuePayload,
  QueueProducer,
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
    jobs: OcrJobsRepository[F],
    drafts: OcrDraftsRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    queue: QueueProducer[F],
    now: F[Instant],
    nextId: F[String],
    requestIdLookup: F[Option[String]],
):
  import CreateOcrJob.*

  def run(command: CreateOcrJobCommand): F[Either[AppError, CreatedOcrJob]] = (for
    screenType <- EitherT.fromEither[F](requestedScreenType(command))
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
      command.ocrHints,
      requestId,
    )
    _ <- EitherT.liftF(drafts.create(draft))
    _ <- EitherT.liftF(jobs.create(job))
    _ <- draftForMatch match
      case Some(draftRecord) => matchDrafts.attachOcrArtifacts(
          draftId = draftRecord.id,
          screenType = screenType,
          sourceImageId = command.imageId,
          ocrDraftId = draft.id,
          updatedAt = createdAt,
        ).ensureFoundF("match draft", draftRecord.id.value)
      case None => EitherT.rightT[F, AppError](())
    published <- EitherT(queue.publish(payload).redeemWith(
      error =>
        val markDraftFailure = command.matchDraftId match
          case Some(id) => matchDrafts.markOcrFailed(id, createdAt).void
          case None => MonadThrow[F].unit
        // Wrap the compensation chain in `attempt` so a secondary failure (e.g. DB outage during
        // markFailed / markDraftFailure) does not propagate and override the user-facing
        // `AppError.Internal`. The user-visible result is always Internal regardless of
        // compensation outcome.
        // NOTE: replace `attempt.void` with structured logging once a `Logger[F]` is wired into
        // usecases; tracked as a follow-up to phase6-ocr-compensation.
        val compensate =
          (jobs.markFailed(jobId, queueFailure(error), createdAt) >> markDraftFailure).attempt.void
        compensate >> AppError.Internal("Failed to enqueue OCR job.").asLeft[CreatedOcrJob].pure[F]
      ,
      _ => CreatedOcrJob(job, draft, payload).asRight[AppError].pure[F],
    ))
  yield published).value

object CreateOcrJob:
  private def requestedScreenType(command: CreateOcrJobCommand): Either[AppError, ScreenType] =
    ScreenType.fromWire(command.requestedImageType).toRight(AppError.ValidationFailed(
      "requestedImageType must be auto, total_assets, revenue, or incident_log."
    ))

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
    payloadJson = Json.obj(
      "requested_screen_type" -> Json.fromString(screenType.wire),
      "detected_screen_type" -> Json.Null,
      "profile_id" -> Json.Null,
      "players" -> Json.arr(),
      "category_payload" -> Json.obj(),
      "warnings" -> Json.arr(),
      "raw_snippets" -> Json.Null,
    ),
    warningsJson = Json.arr(),
    timingsMsJson = Json.obj(),
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

  private def queueFailure(error: Throwable): OcrFailure = OcrFailure(
    code = FailureCode.QueueFailure,
    message = s"Failed to enqueue OCR job: ${error.getMessage}",
    retryable = false,
    userAction = Some("運用に連絡してください"),
  )
