package momo.api.repositories

import cats.~>

import momo.api.domain.ids.HeldEventId

enum HeldEventDeletionResult derives CanEqual:
  case Deleted
  case NotFound
  case HasConfirmedMatches
  case HasMatchDrafts
  case Referenced

trait HeldEventDeletionAlg[F0[_]]:
  def deleteIfUnreferenced(id: HeldEventId): F0[HeldEventDeletionResult]

trait HeldEventDeletionRepository[F[_]] extends HeldEventDeletionAlg[F]

object HeldEventDeletionRepository:
  def fromAlg[F0[_], F[_]](
      alg: HeldEventDeletionAlg[F0],
      liftK: F0 ~> F,
  ): HeldEventDeletionRepository[F] = new HeldEventDeletionRepository[F]:
    def deleteIfUnreferenced(id: HeldEventId): F[HeldEventDeletionResult] =
      liftK(alg.deleteIfUnreferenced(id))

end HeldEventDeletionRepository
