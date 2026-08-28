package momo.api.repositories

import java.time.Instant

import cats.~>

import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.{
  MatchListItem,
  MatchListKindFilter,
  MatchListSort,
  MatchListStatusFilter,
  MatchListSummary
}

trait MatchListAlg[F0[_]]:
  def list(filter: MatchListReadModel.Filter): F0[MatchListReadModel.CursorPage[MatchListItem]]
  def listDraftsByHeldEvent(heldEventId: HeldEventId): F0[List[MatchListItem]]
  def summarize(filter: MatchListReadModel.SummaryFilter): F0[MatchListSummary]

trait MatchListReadModel[F[_]] extends MatchListAlg[F]

object MatchListReadModel:
  enum CursorDirection derives CanEqual:
    case After
    case Before

  /**
   * A complete stable-sort key. Every persisted cursor position is still constrained by the
   * current request filters when it is applied by a repository. Positions are unsigned client
   * input, so a repository must never replace scope predicates with the position predicate.
   */
  final case class CursorPosition(
      statusPriority: Int,
      updatedAt: Instant,
      heldAt: Instant,
      matchNoIsNull: Boolean,
      matchNoSort: Int,
      kind: String,
      id: String,
  )

  /**
   * `totalItems` is an exact snapshot from the first page request. Cursor requests deliberately
   * reuse that value so navigating a result set never repeats the full COUNT query. A refresh or
   * filter change must discard the cursor to take a new count snapshot.
   */
  final case class Cursor(
      direction: CursorDirection,
      page: Int,
      totalItems: Int,
      position: Option[CursorPosition],
  )

  final case class CursorPageRequest(pageSize: Int, cursor: Option[Cursor] = None)

  final case class CursorPage[A](
      items: List[A],
      pageSize: Int,
      totalItems: Int,
      page: Int,
      previousCursor: Option[Cursor],
      nextCursor: Option[Cursor],
      lastCursor: Option[Cursor],
  ):
    val totalPages: Int =
      if totalItems <= 0 then 0
      else ((totalItems.toLong + pageSize.toLong - 1L) / pageSize.toLong).toInt

    val hasPreviousPage: Boolean = previousCursor.nonEmpty
    val hasNextPage: Boolean = nextCursor.nonEmpty

  final case class Filter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      status: MatchListStatusFilter = MatchListStatusFilter.All,
      kind: MatchListKindFilter = MatchListKindFilter.All,
      page: CursorPageRequest = CursorPageRequest(pageSize = 100),
      sort: MatchListSort = MatchListSort.StatusPriority,
  )

  final case class SummaryFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
  )

  def fromAlg[F0[_], F[_]](alg: MatchListAlg[F0], liftK: F0 ~> F): MatchListReadModel[F] =
    new MatchListReadModel[F]:
      def list(filter: Filter): F[CursorPage[MatchListItem]] = liftK(alg.list(filter))
      def listDraftsByHeldEvent(heldEventId: HeldEventId): F[List[MatchListItem]] =
        liftK(alg.listDraftsByHeldEvent(heldEventId))
      def summarize(filter: SummaryFilter): F[MatchListSummary] = liftK(alg.summarize(filter))
end MatchListReadModel
