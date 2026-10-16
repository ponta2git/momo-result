package momo.api.adapters.inmemory

import momo.api.domain.{HeldEventScope, MatchDraft, MatchDraftStatus}
import momo.api.domain.ids.*
import momo.api.repositories.MatchDraftsRepository

/** Queries used to assemble HTTP test fixtures, not production persistence operations. */
trait MatchDraftFixtureStore[F[_]] extends MatchDraftsRepository[F]:
  def list(filter: MatchDraftFixtureStore.ListFilter): F[List[MatchDraft]]
  def statsByHeldEvents(ids: List[HeldEventId]): F[Map[HeldEventId, MatchDraftFixtureStore.HeldEventStats]]

object MatchDraftFixtureStore:
  final case class HeldEventStats(
      draftCount: Int,
      maxMatchNo: Int,
      scopes: List[HeldEventScope] = Nil,
  )

  final case class ListFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      statuses: Set[MatchDraftStatus] = Set.empty,
      limit: Option[Int] = None,
  )
