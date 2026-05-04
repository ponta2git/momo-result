package momo.api.repositories

import java.time.Instant

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.MatchRecord
import momo.api.domain.ids.MatchDraftId

trait MatchConfirmationAlg[F0[_]]:
  def confirm(record: MatchRecord, draftId: Option[MatchDraftId], updatedAt: Instant): F0[Boolean]

trait MatchConfirmationRepository[F[_]]:
  def confirm(record: MatchRecord, draftId: Option[MatchDraftId], updatedAt: Instant): F[Boolean]

object MatchConfirmationRepository:
  def fromConnectionIO[F[_]](
      alg: MatchConfirmationAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): MatchConfirmationRepository[F] = new MatchConfirmationRepository[F]:
    def confirm(
        record: MatchRecord,
        draftId: Option[MatchDraftId],
        updatedAt: Instant,
    ): F[Boolean] = transactK(alg.confirm(record, draftId, updatedAt))

  def liftIdentity[F[_]](alg: MatchConfirmationAlg[F]): MatchConfirmationRepository[F] =
    new MatchConfirmationRepository[F]:
      def confirm(
          record: MatchRecord,
          draftId: Option[MatchDraftId],
          updatedAt: Instant,
      ): F[Boolean] = alg.confirm(record, draftId, updatedAt)
end MatchConfirmationRepository
