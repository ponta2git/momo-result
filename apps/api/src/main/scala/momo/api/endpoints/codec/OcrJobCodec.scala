package momo.api.endpoints.codec

import momo.api.domain.OcrJobHints
import momo.api.domain.ids.*
import momo.api.endpoints.{CreateOcrJobRequest, CreateOcrJobResponse}
import momo.api.usecases.{CreateOcrJobCommand, CreatedOcrJob}

/** DTO ↔ usecase command conversions for `OcrJobEndpoints`. */
object OcrJobCodec:
  def toCreateCommand(request: CreateOcrJobRequest): CreateOcrJobCommand = CreateOcrJobCommand(
    imageId = ImageId(request.imageId),
    requestedImageType = request.requestedImageType,
    ocrHints = request.ocrHints.getOrElse(OcrJobHints()),
    matchDraftId = request.matchDraftId.map(MatchDraftId(_)),
  )

  def toCreateResponse(created: CreatedOcrJob): CreateOcrJobResponse = CreateOcrJobResponse(
    jobId = created.job.id.value,
    draftId = created.draft.id.value,
    status = created.job.status.wire,
  )
end OcrJobCodec
