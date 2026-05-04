package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*

import momo.api.domain.OcrDraft
import momo.api.domain.ids.*
import momo.api.repositories.OcrDraftsRepository

final class InMemoryOcrDraftsRepository[F[_]: Sync] private (ref: Ref[F, Map[String, OcrDraft]])
    extends OcrDraftsRepository[F]:
  override def create(draft: OcrDraft): F[Unit] = ref.update(_ + (draft.id.value -> draft))

  override def find(draftId: OcrDraftId): F[Option[OcrDraft]] = ref.get.map(_.get(draftId.value))

object InMemoryOcrDraftsRepository:
  def create[F[_]: Sync]: F[InMemoryOcrDraftsRepository[F]] = Ref
    .of[F, Map[String, OcrDraft]](Map.empty).map(new InMemoryOcrDraftsRepository(_))
