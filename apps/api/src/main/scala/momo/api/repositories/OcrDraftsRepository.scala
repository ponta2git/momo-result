package momo.api.repositories

import cats.~>

import momo.api.domain.OcrDraft
import momo.api.domain.ids.OcrDraftId

trait OcrDraftsAlg[F0[_]]:
  def create(draft: OcrDraft): F0[Unit]
  def find(draftId: OcrDraftId): F0[Option[OcrDraft]]
  def findMany(draftIds: List[OcrDraftId]): F0[Map[OcrDraftId, OcrDraft]]

trait OcrDraftsRepository[F[_]]:
  def find(draftId: OcrDraftId): F[Option[OcrDraft]]
  def findMany(draftIds: List[OcrDraftId]): F[Map[OcrDraftId, OcrDraft]]

object OcrDraftsRepository:
  def fromAlg[F0[_], F[_]](alg: OcrDraftsAlg[F0], liftK: F0 ~> F): OcrDraftsRepository[F] =
    new OcrDraftsRepository[F]:
      def find(draftId: OcrDraftId): F[Option[OcrDraft]] = liftK(alg.find(draftId))
      def findMany(draftIds: List[OcrDraftId]): F[Map[OcrDraftId, OcrDraft]] =
        liftK(alg.findMany(draftIds))
end OcrDraftsRepository
