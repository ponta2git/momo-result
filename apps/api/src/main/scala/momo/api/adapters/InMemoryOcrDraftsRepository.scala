package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.OcrDraft
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.OcrDraftsRepository

final class InMemoryOcrDraftsRepository[F[_]: Sync] private (ref: Ref[F, Map[String, OcrDraft]])
    extends OcrDraftsRepository[F]:
  override def create(draft: OcrDraft): F[Unit] = ref.modify { current =>
    if current.contains(draft.id.value) then
      current ->
        Left(new AppException(AppError.Conflict(s"ocr draft already exists: ${draft.id.value}")))
    else current.updated(draft.id.value, draft) -> Right(())
  }.flatMap {
    case Right(()) => Sync[F].unit
    case Left(error) => Sync[F].raiseError(error)
  }

  override def find(draftId: OcrDraftId): F[Option[OcrDraft]] = ref.get.map(_.get(draftId.value))

object InMemoryOcrDraftsRepository:
  def create[F[_]: Sync]: F[InMemoryOcrDraftsRepository[F]] = Ref
    .of[F, Map[String, OcrDraft]](Map.empty).map(new InMemoryOcrDraftsRepository(_))
