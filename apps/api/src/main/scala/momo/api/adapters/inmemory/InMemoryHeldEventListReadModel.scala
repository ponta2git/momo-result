package momo.api.adapters.inmemory

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{HeldEventListItem, HeldEventListPage, HeldEventScopeSummary, PageRequest, PagedResult}
import momo.api.repositories.{GameTitlesRepository, HeldEventListReadModel, HeldEventsRepository, MatchDraftsRepository, MatchesRepository, SeasonMastersRepository}

final class InMemoryHeldEventListReadModel[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    drafts: MatchDraftsRepository[F],
    gameTitles: GameTitlesRepository[F],
    seasons: SeasonMastersRepository[F],
) extends HeldEventListReadModel[F]:
  override def list(query: Option[String], page: PageRequest): F[HeldEventListPage] =
    for
      result <- events.listPage(query, page)
      allIds <- events.listIds(query)
      matchStats <- matches.statsByHeldEvents(allIds)
      draftStats <- drafts.statsByHeldEvents(result.items.map(_.id))
      items <- result.items.traverse { event =>
        val confirmed = matchStats.getOrElse(event.id, MatchesRepository.HeldEventStats(0, 0))
        val pending = draftStats.getOrElse(event.id, MatchDraftsRepository.HeldEventStats(0, 0))
        (confirmed.scopes ++ pending.scopes).distinct.traverse { scope =>
          for
            title <- scope.gameTitleId.traverse(gameTitles.find).map(_.flatten)
            season <- scope.seasonMasterId.traverse(seasons.find).map(_.flatten)
          yield HeldEventScopeSummary(scope, title.map(_.name), season.map(_.name))
        }.map(scopes => HeldEventListItem(
          event, confirmed.matchCount, pending.draftCount,
          math.max(confirmed.maxMatchNo, pending.maxMatchNo) + 1,
          HeldEventScopeSummary.ordered(scopes),
        ))
      }
    yield HeldEventListPage(PagedResult(items, page, result.totalItems), matchStats.values.map(_.matchCount).sum)
