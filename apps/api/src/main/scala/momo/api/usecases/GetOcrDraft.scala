package momo.api.usecases

import cats.Functor

import momo.api.domain.OcrDraft
import momo.api.domain.ids.OcrDraftId
import momo.api.errors.AppError
import momo.api.repositories.OcrDraftsRepository
import momo.api.usecases.syntax.UseCaseSyntax.*

final class GetOcrDraft[F[_]: Functor](drafts: OcrDraftsRepository[F]):
  def run(draftId: OcrDraftId): F[Either[AppError, OcrDraft]] = drafts.find(draftId)
    .orNotFound("ocr draft", draftId.value).value
