package momo.api.endpoints.codec

import momo.api.domain.OcrJobHints
import momo.api.domain.ids.*
import momo.api.endpoints.{CreateOcrJobRequest, CreateOcrJobResponse}
import momo.api.usecases.{CreateOcrJobCommand, CreatedOcrJob}

/** DTO ↔ usecase command conversions for `OcrJobEndpoints`. */
object OcrJobCodec:
  def toCreateCommand(request: CreateOcrJobRequest): CreateOcrJobCommand = CreateOcrJobCommand(
    imageId = ImageId.unsafeFromString(request.imageId),
    requestedScreenType = request.requestedScreenType,
    ocrHints = request.ocrHints.fold(OcrJobHints.empty)(_.asDomain),
    matchDraftId = request.matchDraftId.map(MatchDraftId.unsafeFromString(_)),
  )

  def toCreateResponse(created: CreatedOcrJob): CreateOcrJobResponse = CreateOcrJobResponse(
    jobId = created.job.id.value,
    draftId = created.draft.id.value,
    status = created.job.status.wire,
  )
end OcrJobCodec
