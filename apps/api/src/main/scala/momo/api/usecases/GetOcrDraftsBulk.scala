package momo.api.usecases

import cats.Monad
import cats.syntax.all.*
import momo.api.domain.OcrDraft
import momo.api.domain.ids.DraftId
import momo.api.errors.AppError
import momo.api.repositories.OcrDraftsRepository

final class GetOcrDraftsBulk[F[_]: Monad](drafts: OcrDraftsRepository[F]):
  def run(idsCsv: String): F[Either[AppError, List[OcrDraft]]] =
    val ids = idsCsv.split(",").map(_.trim).filter(_.nonEmpty).toList
    if ids.isEmpty then
      Monad[F].pure(Left(AppError.ValidationFailed("ids query must contain at least 1 id.")))
    else
      ids
        .traverse(id => drafts.find(DraftId(id)).map(_.toRight(id)))
        .map { results =>
          val missing = results.collect { case Left(id) => id }
          if missing.nonEmpty then Left(AppError.NotFound("ocr draft", missing.mkString(",")))
          else Right(results.collect { case Right(d) => d })
        }
