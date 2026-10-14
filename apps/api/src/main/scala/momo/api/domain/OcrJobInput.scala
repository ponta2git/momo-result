package momo.api.domain


import momo.api.domain.ids.*

final case class OcrJobInput(
    jobId: OcrJobId,
    draftId: OcrDraftId,
    imageId: ImageId,
    imageLocation: StoredImageLocation,
    imageSha256: String,
    imageByteLength: Long,
    imageMediaType: String,
    requestedScreenType: ScreenType,
    hints: OcrJobHints,
    requestId: Option[String],
)

object OcrJobInput:

  def initial(
      job: OcrJob.Queued,
      image: StoredImage,
      hints: OcrJobHints,
      requestId: Option[String],
  ): OcrJobInput = OcrJobInput(
    jobId = job.id,
    draftId = job.draftId,
    imageId = image.imageId,
    imageLocation = image.location,
    imageSha256 = image.sha256,
    imageByteLength = image.sizeBytes,
    imageMediaType = image.mediaType,
    requestedScreenType = job.requestedScreenType,
    hints = hints,
    requestId = requestId,
  )
