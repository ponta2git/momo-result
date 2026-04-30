package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import io.circe.Json
import java.time.Instant
import momo.api.adapters.OcrStreamPayload
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{ImageStore, OcrDraftsRepository, OcrJobsRepository, QueueProducer}

final case class CreateOcrJobCommand(
    imageId: String,
    requestedImageType: String,
    ocrHints: OcrJobHints,
)

final case class CreatedOcrJob(job: OcrJob, draft: OcrDraft, streamPayload: OcrStreamPayload)

final class CreateOcrJob[F[_]: MonadThrow](
    imageStore: ImageStore[F],
    jobs: OcrJobsRepository[F],
    drafts: OcrDraftsRepository[F],
    queue: QueueProducer[F],
    now: F[Instant],
    nextId: F[String],
):
  def run(command: CreateOcrJobCommand): F[Either[AppError, CreatedOcrJob]] = (for
    screenType <- EitherT.fromEither[F](
      ScreenType.fromWire(command.requestedImageType).toRight(AppError.ValidationFailed(
        "requestedImageType must be auto, total_assets, revenue, or incident_log."
      ))
    )
    imageId = ImageId(command.imageId)
    image <-
      EitherT(imageStore.find(imageId).map(_.toRight(AppError.NotFound("image", command.imageId))))
    createdAt <- EitherT.liftF(now)
    jobId <- EitherT.liftF(nextId.map(JobId(_)))
    draftId <- EitherT.liftF(nextId.map(DraftId(_)))
    draft = OcrDraft(
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
    job = OcrJob(
      id = jobId,
      draftId = draftId,
      imageId = imageId,
      imagePath = image.path,
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
    payload = OcrStreamPayload.build(
      jobId = jobId,
      draftId = draftId,
      imageId = imageId,
      imagePath = image.path,
      requestedScreenType = screenType,
      attempt = 1,
      enqueuedAt = createdAt,
      hints = command.ocrHints,
    )
    _ <- EitherT.liftF(drafts.create(draft))
    _ <- EitherT.liftF(jobs.create(job))
    published <- EitherT(queue.publish(payload).attempt.flatMap {
      case Right(_) => CreatedOcrJob(job, draft, payload).asRight[AppError].pure[F]
      case Left(error) =>
        val failure = OcrFailure(
          code = FailureCode.QueueFailure,
          message = s"Failed to enqueue OCR job: ${error.getMessage}",
          retryable = false,
          userAction = Some("運用に連絡してください"),
        )
        jobs.markFailed(jobId, failure, createdAt) >>
          AppError.Internal("Failed to enqueue OCR job.").asLeft[CreatedOcrJob].pure[F]
    })
  yield published).value
