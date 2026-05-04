package momo.api.domain

import java.nio.file.Path
import java.time.Instant

import momo.api.domain.ids.*

enum OcrJobStatus(val wire: String) derives CanEqual:
  case Queued extends OcrJobStatus("queued")
  case Running extends OcrJobStatus("running")
  case Succeeded extends OcrJobStatus("succeeded")
  case Failed extends OcrJobStatus("failed")
  case Cancelled extends OcrJobStatus("cancelled")

final case class OcrFailure(
    code: FailureCode,
    message: String,
    retryable: Boolean,
    userAction: Option[String],
)

final case class OcrJob(
    id: OcrJobId,
    draftId: OcrDraftId,
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
    updatedAt: Instant,
)
