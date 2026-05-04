package momo.api.repositories

import momo.api.domain.OcrDraft
import momo.api.domain.ids.OcrDraftId

trait OcrDraftsRepository[F[_]]:
  def create(draft: OcrDraft): F[Unit]
  def find(draftId: OcrDraftId): F[Option[OcrDraft]]
