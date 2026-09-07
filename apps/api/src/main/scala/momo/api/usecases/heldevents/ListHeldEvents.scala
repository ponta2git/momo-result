package momo.api.usecases.heldevents

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{HeldEvent, HeldEventScope, PagedResult}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository,
  HeldEventsRepository,
  MatchDraftsRepository,
  MatchesRepository,
  SeasonMastersRepository
}
import momo.api.usecases.common.ListPagination

final case class HeldEventListPage(
    items: List[HeldEventListItem],
    pagination: PagedResult[HeldEvent],
    totalMatchCount: Int,
)

final case class HeldEventListItem(
    event: HeldEvent,
    matchCount: Int,
    draftCount: Int,
    nextMatchNo: Int,
    scopes: List[HeldEventScopeSummary],
)

final case class HeldEventScopeSummary(
    scope: HeldEventScope,
    gameTitleName: Option[String],
    seasonName: Option[String],
)

final class ListHeldEvents[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    drafts: MatchDraftsRepository[F],
    gameTitles: GameTitlesRepository[F],
    seasons: SeasonMastersRepository[F],
):
  def run(
      query: Option[String],
      limit: Option[Int],
      page: Option[Int],
      pageSize: Option[Int],
  ): F[Either[AppError, HeldEventListPage]] =
    ListPagination.validate(page, pageSize, limit, ListPagination.HeldEvents) match
      case Left(error) => Monad[F].pure(Left(error))
      case Right(validPage) =>
        for
          page <- events.listPage(query, validPage)
          allIds <- events.listIds(query)
          matchStats <- matches.statsByHeldEvents(allIds)
          draftStats <- drafts.statsByHeldEvents(allIds)
          titles <- gameTitles.list
          seasonMasters <- seasons.list(None)
          titleNames = titles.map(title => title.id -> title.name).toMap
          seasonNames = seasonMasters.map(season => season.id -> season.name).toMap
        yield Right(HeldEventListPage(
          items = page.items.map { event =>
            val confirmed = matchStats.getOrElse(event.id, MatchesRepository.HeldEventStats(0, 0))
            val pending = draftStats.getOrElse(
              event.id,
              MatchDraftsRepository.HeldEventStats(0, 0),
            )
            HeldEventListItem(
              event = event,
              matchCount = confirmed.matchCount,
              draftCount = pending.draftCount,
              nextMatchNo = math.max(confirmed.maxMatchNo, pending.maxMatchNo) + 1,
              scopes = (confirmed.scopes ++ pending.scopes).distinct.map(scope =>
                HeldEventScopeSummary(
                  scope,
                  scope.gameTitleId.flatMap(titleNames.get),
                  scope.seasonMasterId.flatMap(seasonNames.get),
                )
              ).sortBy(summary =>
                (
                  summary.gameTitleName.getOrElse(""),
                  summary.seasonName.getOrElse(""),
                  summary.scope.gameTitleId.map(_.value).getOrElse(""),
                  summary.scope.seasonMasterId.map(_.value).getOrElse(""),
                )
              ),
            )
          },
          pagination = page,
          totalMatchCount = matchStats.values.map(_.matchCount).sum,
        ))
