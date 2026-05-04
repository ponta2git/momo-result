package momo.api.repositories

import momo.api.domain.OcrDraft
import momo.api.domain.ids.DraftId

trait OcrDraftsRepository[F[_]]:
  def create(draft: OcrDraft): F[Unit]
  def find(draftId: DraftId): F[Option[OcrDraft]]
