package momo.api.endpoints

import io.circe.{Codec, Json}
import java.time.format.DateTimeFormatter
import momo.api.domain.{OcrDraft, OcrJob, OcrJobHints, StoredImage}
import momo.api.domain.ids.*

final case class AuthMeResponse(memberId: String, displayName: String) derives Codec.AsObject

final case class UploadImageResponse(
    imageId: String,
    imagePath: String,
    mediaType: String,
    sizeBytes: Long,
) derives Codec.AsObject

object UploadImageResponse:
  def from(image: StoredImage): UploadImageResponse = UploadImageResponse(
    imageId = image.imageId.value,
    imagePath = image.path.toString,
    mediaType = image.mediaType,
    sizeBytes = image.sizeBytes,
  )

final case class CreateOcrJobRequest(
    imageId: String,
    requestedImageType: String,
    ocrHints: Option[OcrJobHints] = None,
) derives Codec.AsObject

final case class CreateOcrJobResponse(jobId: String, draftId: String, status: String)
    derives Codec.AsObject

final case class OcrFailureResponse(
    code: String,
    message: String,
    retryable: Boolean,
    userAction: Option[String],
) derives Codec.AsObject

final case class OcrJobResponse(
    jobId: String,
    draftId: String,
    imageId: String,
    imagePath: String,
    requestedImageType: String,
    detectedImageType: Option[String],
    status: String,
    attemptCount: Int,
    failure: Option[OcrFailureResponse],
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object OcrJobResponse:
  def from(job: OcrJob): OcrJobResponse = OcrJobResponse(
    jobId = job.id.value,
    draftId = job.draftId.value,
    imageId = job.imageId.value,
    imagePath = job.imagePath.toString,
    requestedImageType = job.requestedScreenType.wire,
    detectedImageType = job.detectedScreenType.map(_.wire),
    status = job.status.wire,
    attemptCount = job.attemptCount,
    failure = job.failure
      .map(f => OcrFailureResponse(f.code.wire, f.message, f.retryable, f.userAction)),
    createdAt = DateTimeFormatter.ISO_INSTANT.format(job.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(job.updatedAt),
  )

final case class OcrDraftResponse(
    draftId: String,
    jobId: String,
    requestedImageType: String,
    detectedImageType: Option[String],
    profileId: Option[String],
    payloadJson: Json,
    warningsJson: Json,
    timingsMsJson: Json,
    createdAt: String,
    updatedAt: String,
) derives Codec.AsObject

object OcrDraftResponse:
  def from(draft: OcrDraft): OcrDraftResponse = OcrDraftResponse(
    draftId = draft.id.value,
    jobId = draft.jobId.value,
    requestedImageType = draft.requestedScreenType.wire,
    detectedImageType = draft.detectedScreenType.map(_.wire),
    profileId = draft.profileId,
    payloadJson = draft.payloadJson,
    warningsJson = draft.warningsJson,
    timingsMsJson = draft.timingsMsJson,
    createdAt = DateTimeFormatter.ISO_INSTANT.format(draft.createdAt),
    updatedAt = DateTimeFormatter.ISO_INSTANT.format(draft.updatedAt),
  )

final case class CancelOcrJobResponse(jobId: String, status: String) derives Codec.AsObject
