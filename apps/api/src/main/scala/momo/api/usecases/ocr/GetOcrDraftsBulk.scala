package momo.api.usecases.ocr

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.OcrDraft
import momo.api.domain.ids.OcrDraftId
import momo.api.errors.AppError
import momo.api.repositories.OcrDraftsRepository

final class GetOcrDraftsBulk[F[_]: Monad](drafts: OcrDraftsRepository[F]):
  def run(ids: List[OcrDraftId]): F[Either[AppError, List[OcrDraft]]] =
    if ids.isEmpty then
      Monad[F].pure(Left(AppError.ValidationFailed("ids query must contain at least 1 id.")))
    else if ids.size > OcrDraft.MaxBulkIds then
      Monad[F].pure(Left(AppError.ValidationFailed(s"ids query must contain at most ${OcrDraft
          .MaxBulkIds.toString} ids.")))
    else
      drafts.findMany(ids).map { draftsById =>
        val missing = ids.filterNot(draftsById.contains)
        if missing.nonEmpty then
          Left(AppError.NotFound("ocr draft", missing.map(_.value).mkString(",")))
        else Right(ids.map(draftsById))
      }
