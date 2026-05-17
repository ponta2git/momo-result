package momo.api.repositories

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.{MatchListItem, MatchListKindFilter, MatchListStatusFilter}

trait MatchListAlg[F0[_]]:
  def list(filter: MatchListReadModel.Filter): F0[List[MatchListItem]]

trait MatchListReadModel[F[_]]:
  def list(filter: MatchListReadModel.Filter): F[List[MatchListItem]]

object MatchListReadModel:
  final case class Filter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      status: MatchListStatusFilter = MatchListStatusFilter.All,
      kind: MatchListKindFilter = MatchListKindFilter.All,
      limit: Option[Int] = None,
  )

  def fromConnectionIO[F[_]](
      alg: MatchListAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): MatchListReadModel[F] = new MatchListReadModel[F]:
    def list(filter: Filter): F[List[MatchListItem]] = transactK(alg.list(filter))

  def liftIdentity[F[_]](alg: MatchListAlg[F]): MatchListReadModel[F] = new MatchListReadModel[F]:
    export alg.*
end MatchListReadModel
