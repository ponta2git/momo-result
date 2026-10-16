package momo.api.adapters.inmemory

import momo.api.domain.ids.*
import momo.api.domain.{HeldEventScope, MatchRecord}
import momo.api.repositories.MatchesRepository

/** Queries used to assemble HTTP test fixtures, not production persistence operations. */
trait MatchFixtureStore[F[_]] extends MatchesRepository[F]:
  def list(filter: MatchFixtureStore.ListFilter): F[List[MatchRecord]]
  def listByHeldEvent(id: HeldEventId): F[List[MatchRecord]]
  def statsByHeldEvents(ids: List[HeldEventId])
      : F[Map[HeldEventId, MatchFixtureStore.HeldEventStats]]

object MatchFixtureStore:
  final case class HeldEventStats(
      matchCount: Int,
      maxMatchNo: Int,
      scopes: List[HeldEventScope] = Nil,
  )

  final case class ListFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      matchId: Option[MatchId] = None,
      limit: Option[Int] = None,
  )
