package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import io.circe.Json
import java.time.Instant
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{
  ImageStore, OcrDraftsRepository, OcrJobsRepository, OcrQueuePayload, QueueProducer,
}

final case class CreateOcrJobCommand(
    imageId: String,
    requestedImageType: String,
    ocrHints: OcrJobHints,
)

final case class CreatedOcrJob(job: OcrJob, draft: OcrDraft, queuePayload: OcrQueuePayload)

final class CreateOcrJob[F[_]: MonadThrow](
    imageStore: ImageStore[F],
    jobs: OcrJobsRepository[F],
    drafts: OcrDraftsRepository[F],
    queue: QueueProducer[F],
    now: F[Instant],
    nextId: F[String],
):
  import CreateOcrJob.*

  def run(command: CreateOcrJobCommand): F[Either[AppError, CreatedOcrJob]] = (for
    screenType <- EitherT.fromEither[F](requestedScreenType(command))
    imageId = ImageId(command.imageId)
    image <-
      EitherT(imageStore.find(imageId).map(_.toRight(AppError.NotFound("image", command.imageId))))
    createdAt <- EitherT.liftF(now)
    jobId <- EitherT.liftF(nextId.map(JobId(_)))
    draftId <- EitherT.liftF(nextId.map(DraftId(_)))
    draft = initialDraft(draftId, jobId, screenType, createdAt)
    job = queuedJob(jobId, draftId, imageId, image.path, screenType, createdAt)
    payload =
      queuePayload(jobId, draftId, imageId, image.path, screenType, createdAt, command.ocrHints)
    _ <- EitherT.liftF(drafts.create(draft))
    _ <- EitherT.liftF(jobs.create(job))
    published <- EitherT(queue.publish(payload).attempt.flatMap {
      case Right(_) => CreatedOcrJob(job, draft, payload).asRight[AppError].pure[F]
      case Left(error) => jobs.markFailed(jobId, queueFailure(error), createdAt) >>
          AppError.Internal("Failed to enqueue OCR job.").asLeft[CreatedOcrJob].pure[F]
    })
  yield published).value

object CreateOcrJob:
  private def requestedScreenType(command: CreateOcrJobCommand): Either[AppError, ScreenType] =
    ScreenType.fromWire(command.requestedImageType).toRight(AppError.ValidationFailed(
      "requestedImageType must be auto, total_assets, revenue, or incident_log."
    ))

  private def initialDraft(
      draftId: DraftId,
      jobId: JobId,
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
      jobId: JobId,
      draftId: DraftId,
      imageId: ImageId,
      imagePath: java.nio.file.Path,
      screenType: ScreenType,
      createdAt: Instant,
  ): OcrJob = OcrJob(
    id = jobId,
    draftId = draftId,
    imageId = imageId,
    imagePath = imagePath,
    requestedScreenType = screenType,
    detectedScreenType = None,
    status = OcrJobStatus.Queued,
    attemptCount = 0,
    workerId = None,
    failure = None,
    startedAt = None,
    finishedAt = None,
    durationMs = None,
    createdAt = createdAt,
    updatedAt = createdAt,
  )

  private def queuePayload(
      jobId: JobId,
      draftId: DraftId,
      imageId: ImageId,
      imagePath: java.nio.file.Path,
      screenType: ScreenType,
      enqueuedAt: Instant,
      hints: OcrJobHints,
  ): OcrQueuePayload = OcrQueuePayload.build(
    jobId = jobId,
    draftId = draftId,
    imageId = imageId,
    imagePath = imagePath,
    requestedScreenType = screenType,
    attempt = 1,
    enqueuedAt = enqueuedAt,
    hints = hints,
  )

  private def queueFailure(error: Throwable): OcrFailure = OcrFailure(
    code = FailureCode.QueueFailure,
    message = s"Failed to enqueue OCR job: ${error.getMessage}",
    retryable = false,
    userAction = Some("運用に連絡してください"),
  )
