package momo.api.repositories

import cats.~>

import momo.api.domain.ids.{GameTitleId, HeldEventId, SeasonMasterId}
import momo.api.domain.{
  MatchListItem,
  MatchListKindFilter,
  MatchListSort,
  MatchListStatusFilter,
  MatchListSummary,
  PageRequest,
  PagedResult
}

trait MatchListAlg[F0[_]]:
  def list(filter: MatchListReadModel.Filter): F0[PagedResult[MatchListItem]]
  def summarize(filter: MatchListReadModel.SummaryFilter): F0[MatchListSummary]

trait MatchListReadModel[F[_]]:
  def list(filter: MatchListReadModel.Filter): F[PagedResult[MatchListItem]]
  def summarize(filter: MatchListReadModel.SummaryFilter): F[MatchListSummary]

object MatchListReadModel:
  final case class Filter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
      status: MatchListStatusFilter = MatchListStatusFilter.All,
      kind: MatchListKindFilter = MatchListKindFilter.All,
      page: PageRequest = PageRequest(page = 1, pageSize = 100),
      sort: MatchListSort = MatchListSort.StatusPriority,
  )

  final case class SummaryFilter(
      heldEventId: Option[HeldEventId] = None,
      gameTitleId: Option[GameTitleId] = None,
      seasonMasterId: Option[SeasonMasterId] = None,
  )

  def fromAlg[F0[_], F[_]](alg: MatchListAlg[F0], liftK: F0 ~> F): MatchListReadModel[F] =
    new MatchListReadModel[F]:
      def list(filter: Filter): F[PagedResult[MatchListItem]] = liftK(alg.list(filter))
      def summarize(filter: SummaryFilter): F[MatchListSummary] = liftK(alg.summarize(filter))

  def liftIdentity[F[_]](alg: MatchListAlg[F]): MatchListReadModel[F] = new MatchListReadModel[F]:
    export alg.*
end MatchListReadModel
