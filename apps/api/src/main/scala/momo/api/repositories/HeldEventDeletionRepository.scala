package momo.api.repositories

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.ids.HeldEventId

enum HeldEventDeletionResult derives CanEqual:
  case Deleted
  case NotFound
  case HasConfirmedMatches
  case HasMatchDrafts
  case Referenced

trait HeldEventDeletionAlg[F0[_]]:
  def deleteIfUnreferenced(id: HeldEventId): F0[HeldEventDeletionResult]

trait HeldEventDeletionRepository[F[_]]:
  def deleteIfUnreferenced(id: HeldEventId): F[HeldEventDeletionResult]

object HeldEventDeletionRepository:
  def fromConnectionIO[F[_]](
      alg: HeldEventDeletionAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): HeldEventDeletionRepository[F] = new HeldEventDeletionRepository[F]:
    def deleteIfUnreferenced(id: HeldEventId): F[HeldEventDeletionResult] =
      transactK(alg.deleteIfUnreferenced(id))

  def liftIdentity[F[_]](alg: HeldEventDeletionAlg[F]): HeldEventDeletionRepository[F] =
    new HeldEventDeletionRepository[F]:
      export alg.*
end HeldEventDeletionRepository
