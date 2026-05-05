package momo.api.repositories

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.OcrDraft
import momo.api.domain.ids.OcrDraftId

trait OcrDraftsAlg[F0[_]]:
  def create(draft: OcrDraft): F0[Unit]
  def find(draftId: OcrDraftId): F0[Option[OcrDraft]]

trait OcrDraftsRepository[F[_]]:
  def create(draft: OcrDraft): F[Unit]
  def find(draftId: OcrDraftId): F[Option[OcrDraft]]

object OcrDraftsRepository:
  def fromConnectionIO[F[_]](
      alg: OcrDraftsAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): OcrDraftsRepository[F] = new OcrDraftsRepository[F]:
    def create(draft: OcrDraft): F[Unit] = transactK(alg.create(draft))
    def find(draftId: OcrDraftId): F[Option[OcrDraft]] = transactK(alg.find(draftId))

  def liftIdentity[F[_]](alg: OcrDraftsAlg[F]): OcrDraftsRepository[F] = new OcrDraftsRepository[F]:
    export alg.*
end OcrDraftsRepository
