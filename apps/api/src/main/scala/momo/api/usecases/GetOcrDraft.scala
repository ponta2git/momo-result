package momo.api.usecases

import cats.Functor
import cats.syntax.all.*

import momo.api.domain.OcrDraft
import momo.api.domain.ids.DraftId
import momo.api.errors.AppError
import momo.api.repositories.OcrDraftsRepository

final class GetOcrDraft[F[_]: Functor](drafts: OcrDraftsRepository[F]):
  def run(draftId: String): F[Either[AppError, OcrDraft]] = drafts.find(DraftId(draftId))
    .map(_.toRight(AppError.NotFound("ocr draft", draftId)))
