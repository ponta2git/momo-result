package momo.api.endpoints.codec

import momo.api.domain.ids.OcrDraftId
import momo.api.errors.AppError

object OcrDraftCodec:
  def toDraftIds(idsCsv: String): Either[AppError, List[OcrDraftId]] =
    val ids = idsCsv.split(",").iterator.map(_.trim).filter(_.nonEmpty).toList
    Either.cond(
      ids.nonEmpty,
      ids.map(OcrDraftId.unsafeFromString),
      AppError.ValidationFailed("ids query must contain at least 1 id."),
    )
end OcrDraftCodec
