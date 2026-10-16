package momo.api.adapters.inmemory

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{
  HeldEventListItem,
  HeldEventListPage,
  HeldEventScopeSummary,
  PageRequest,
  PagedResult
}
import momo.api.repositories.{GameTitlesRepository, HeldEventListReadModel, SeasonMastersRepository}

final class InMemoryHeldEventListReadModel[F[_]: Monad](
    events: InMemoryHeldEventsRepository[F],
    matches: MatchFixtureStore[F],
    drafts: MatchDraftFixtureStore[F],
    gameTitles: GameTitlesRepository[F],
    seasons: SeasonMastersRepository[F],
) extends HeldEventListReadModel[F]:
  override def list(query: Option[String], page: PageRequest): F[HeldEventListPage] =
    for
      snapshot <- events.snapshot
      all = InMemoryHeldEventsRepository.filterAndSort(snapshot, query)
      result = PagedResult(
        all.slice(page.offset.toInt, page.offset.toInt + page.pageSize),
        page,
        all.size
      )
      allIds = all.map(_.id)
      matchStats <- matches.statsByHeldEvents(allIds)
      draftStats <- drafts.statsByHeldEvents(result.items.map(_.id))
      items <- result.items.traverse { event =>
        val confirmed = matchStats.getOrElse(event.id, MatchFixtureStore.HeldEventStats(0, 0))
        val pending = draftStats.getOrElse(event.id, MatchDraftFixtureStore.HeldEventStats(0, 0))
        (confirmed.scopes ++ pending.scopes).distinct.traverse { scope =>
          for
            title <- scope.gameTitleId.traverse(gameTitles.find).map(_.flatten)
            season <- scope.seasonMasterId.traverse(seasons.find).map(_.flatten)
          yield HeldEventScopeSummary(scope, title.map(_.name), season.map(_.name))
        }.map(scopes =>
          HeldEventListItem(
            event,
            confirmed.matchCount,
            pending.draftCount,
            math.max(confirmed.maxMatchNo, pending.maxMatchNo) + 1,
            HeldEventScopeSummary.ordered(scopes),
          )
        )
      }
    yield HeldEventListPage(
      PagedResult(items, page, result.totalItems),
      matchStats.values.map(_.matchCount).sum
    )
