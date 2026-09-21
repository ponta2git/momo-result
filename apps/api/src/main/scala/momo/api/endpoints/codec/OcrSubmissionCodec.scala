package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.domain.ids.MatchDraftId
import momo.api.domain.{OcrJobHints, OcrSubmissionMember, ScreenType}
import momo.api.endpoints.{OcrJobHintsRequest, PutOcrSubmissionRequest}
import momo.api.errors.AppError
import momo.api.ports.storage.SourceImageIdempotencyHash
import momo.api.usecases.ocr.PutOcrSubmissionCommand

object OcrSubmissionCodec:
  def command(
      id: String,
      request: PutOcrSubmissionRequest
  ): Either[AppError, PutOcrSubmissionCommand] =
    for
      draftId <- BoundaryId.required("matchDraftId", request.matchDraftId)(MatchDraftId.fromString)
      hints <- request.ocrHints.fold(Right(OcrJobHints.empty))(OcrJobHintsRequest.asDomain)
      members <- request.members.traverse { member =>
        for
          screen <- ScreenType.fromExplicitWire(member.screenType).toRight(
            AppError.ValidationFailed("Choose an explicit OCR screen type.")
          )
          _ <- Either.cond(
            member.uploadIdempotencyKey.matches("[A-Za-z0-9_-]{16,128}"),
            (),
            AppError.ValidationFailed(
              "uploadIdempotencyKey must contain 16 to 128 safe characters."
            )
          )
        yield OcrSubmissionMember(
          screen,
          SourceImageIdempotencyHash.fromRawKey(member.uploadIdempotencyKey).value,
          member.imageSha256,
          member.imageByteLength
        )
      }
    yield PutOcrSubmissionCommand(id, draftId, hints, members)
