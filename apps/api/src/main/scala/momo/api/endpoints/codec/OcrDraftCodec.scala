package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.domain.OcrDraft
import momo.api.domain.ids.OcrDraftId
import momo.api.errors.AppError

object OcrDraftCodec:
  def toDraftIds(idsCsv: String): Either[AppError, List[OcrDraftId]] =
    val ids = idsCsv.split(",").iterator.map(_.trim).toList
    if ids.size > OcrDraft.MaxBulkIds then Left(tooManyIds)
    else
      val parsed = ids.zipWithIndex.traverse { case (id, index) =>
        BoundaryId.required(s"ids[$index]", id)(OcrDraftId.fromString)
      }
      parsed.flatMap(values =>
        Either.cond(
          values.nonEmpty,
          values,
          AppError.ValidationFailed("ids query must contain at least 1 id."),
        )
      )

  private def tooManyIds: AppError = AppError
    .ValidationFailed(s"ids query must contain at most ${OcrDraft.MaxBulkIds.toString} ids.")
end OcrDraftCodec
