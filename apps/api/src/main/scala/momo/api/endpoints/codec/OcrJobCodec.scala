package momo.api.endpoints.codec

import momo.api.domain.ScreenType
import momo.api.domain.ids.*
import momo.api.endpoints.{CreateOcrJobRequest, CreateOcrJobResponse}
import momo.api.errors.AppError
import momo.api.repositories.OcrJobAcceptance
import momo.api.usecases.ocr.CreateOcrJobCommand

/** DTO ↔ usecase command conversions for `OcrJobEndpoints`. */
object OcrJobCodec:
  def toCreateCommand(request: CreateOcrJobRequest): Either[AppError, CreateOcrJobCommand] =
    for
      imageId <- BoundaryId.required("imageId", request.imageId)(ImageId.fromString)
      requestedScreenType <- ScreenType.fromExplicitWire(request.requestedScreenType)
        .toRight(AppError.ValidationFailed(
          "requestedScreenType must be total_assets, revenue, or incident_log."
        ))
      _ <- Either.cond(
        momo.api.usecases.ocr.OcrSubmissions.validId(request.submissionId),
        (),
        AppError.ValidationFailed(
          "submissionId is required. Reload the application and start a new reading operation."
        )
      )
    yield CreateOcrJobCommand(
      imageId = imageId,
      requestedScreenType = requestedScreenType,
      submissionId = request.submissionId,
    )

  def toCreateResponse(created: OcrJobAcceptance): CreateOcrJobResponse = CreateOcrJobResponse(
    jobId = created.id.value,
    draftId = created.draftId.value,
    status = created.status.wire,
  )
end OcrJobCodec
