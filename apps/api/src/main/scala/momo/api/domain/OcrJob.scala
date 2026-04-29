package momo.api.domain

import momo.api.domain.ids.*

import java.nio.file.Path
import java.time.Instant

enum OcrJobStatus(val wire: String):
  case Queued extends OcrJobStatus("queued")
  case Running extends OcrJobStatus("running")
  case Succeeded extends OcrJobStatus("succeeded")
  case Failed extends OcrJobStatus("failed")
  case Cancelled extends OcrJobStatus("cancelled")

final case class OcrFailure(
    code: FailureCode,
    message: String,
    retryable: Boolean,
    userAction: Option[String]
)

final case class OcrJob(
    id: JobId,
    draftId: DraftId,
    imageId: ImageId,
    imagePath: Path,
    requestedScreenType: ScreenType,
    detectedScreenType: Option[ScreenType],
    status: OcrJobStatus,
    attemptCount: Int,
    workerId: Option[String],
    failure: Option[OcrFailure],
    startedAt: Option[Instant],
    finishedAt: Option[Instant],
    durationMs: Option[Int],
    createdAt: Instant,
    updatedAt: Instant
)
