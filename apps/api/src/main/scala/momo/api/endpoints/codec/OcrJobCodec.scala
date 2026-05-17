package momo.api.endpoints.codec

import momo.api.domain.OcrJobHints
import momo.api.domain.ids.*
import momo.api.endpoints.{CreateOcrJobRequest, CreateOcrJobResponse, OcrJobHintsRequest}
import momo.api.errors.AppError
import momo.api.usecases.{CreateOcrJobCommand, CreatedOcrJob}

/** DTO ↔ usecase command conversions for `OcrJobEndpoints`. */
object OcrJobCodec:
  def toCreateCommand(request: CreateOcrJobRequest): Either[AppError, CreateOcrJobCommand] =
    for
      imageId <- BoundaryId.required("imageId", request.imageId)(ImageId.fromString)
      hints <- request.ocrHints.fold(Right(OcrJobHints.empty))(OcrJobHintsRequest.asDomain)
      matchDraftId <- BoundaryId
        .optional("matchDraftId", request.matchDraftId)(MatchDraftId.fromString)
    yield CreateOcrJobCommand(
      imageId = imageId,
      requestedScreenType = request.requestedScreenType,
      ocrHints = hints,
      matchDraftId = matchDraftId,
    )

  def toCreateResponse(created: CreatedOcrJob): CreateOcrJobResponse = CreateOcrJobResponse(
    jobId = created.job.id.value,
    draftId = created.draft.id.value,
    status = created.job.status.wire,
  )
end OcrJobCodec
