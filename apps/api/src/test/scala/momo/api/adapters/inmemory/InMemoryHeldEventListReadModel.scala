package momo.api.adapters.inmemory

import scala.math.BigDecimal.RoundingMode

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{
  HeldEventListItem,
  HeldEventListMetric,
  HeldEventListPage,
  HeldEventListSearchCriteria,
  HeldEventListSort,
  HeldEventNoteMatch,
  HeldEventPlayerResult,
  HeldEventScopeSummary,
  MatchRecord,
  PageRequest,
  PagedResult
}
import momo.api.repositories.{GameTitlesRepository, HeldEventListReadModel, SeasonMastersRepository}

/**
 * HTTP double for list wiring, sorting, pagination and the row projection. Of the search
 * criteria only the note phrase is simulated (it drives `noteMatch`); title, season, map, period,
 * match-count and player-metric semantics are verified on PostgreSQL in
 * `PostgresHeldEventListReadModelSpec`.
 */
final class InMemoryHeldEventListReadModel[F[_]: Monad](
    events: InMemoryHeldEventsRepository[F],
    matches: MatchFixtureStore[F],
    drafts: MatchDraftFixtureStore[F],
    gameTitles: GameTitlesRepository[F],
    seasons: SeasonMastersRepository[F],
) extends HeldEventListReadModel[F]:
  override def list(
      search: HeldEventListSearchCriteria,
      sort: HeldEventListSort,
      page: PageRequest,
  ): F[HeldEventListPage] =
    for
      snapshot <- events.snapshot
      newestFirst = InMemoryHeldEventsRepository.sorted(snapshot, HeldEventListSort.HeldDesc)
      ordered = InMemoryHeldEventsRepository.sorted(snapshot, sort)
      confirmedByEvent <-
        ordered.traverse(event => matches.listByHeldEvent(event.id).map(event.id -> _))
          .map(_.toMap)
      all = ordered.filter(event =>
        search.noteQuery.forall(query => noteHits(confirmedByEvent(event.id), query).nonEmpty)
      )
      result = PagedResult(
        all.slice(page.offset.toInt, page.offset.toInt + page.pageSize),
        page,
        all.size
      )
      matchStats <- matches.statsByHeldEvents(all.map(_.id))
      draftStats <- drafts.statsByHeldEvents(result.items.map(_.id))
      items <- result.items.traverse { event =>
        val confirmed = matchStats.getOrElse(event.id, MatchFixtureStore.HeldEventStats(0, 0))
        val pending = draftStats.getOrElse(event.id, MatchDraftFixtureStore.HeldEventStats(0, 0))
        val records = confirmedByEvent(event.id)
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
            playerResults(records),
            search.noteQuery.flatMap(query => noteMatch(noteHits(records, query))),
          )
        )
      }
    yield HeldEventListPage(
      PagedResult(items, page, result.totalItems),
      matchStats.values.map(_.matchCount).sum,
      newestFirst.headOption.map(_.id),
    )

  private def noteHits(records: List[MatchRecord], query: String): List[MatchRecord] = records
    .filter(_.note.body.exists(_.value.toLowerCase.contains(query.toLowerCase)))
    .sortBy(_.matchNoInEvent.value)

  private def noteMatch(hits: List[MatchRecord]): Option[HeldEventNoteMatch] = hits.headOption
    .flatMap(first =>
      first.note.body.map(body =>
        HeldEventNoteMatch(first.id, first.matchNoInEvent.value, body.value, hits.size - 1)
      )
    )

  private def playerResults(records: List[MatchRecord]): List[HeldEventPlayerResult] = records
    .flatMap(_.players.toList).groupBy(_.memberId).toList.map { case (memberId, results) =>
      val ranks = results.map(_.rank.value)
      HeldEventPlayerResult(
        memberId,
        (BigDecimal(ranks.sum) / ranks.size)
          .setScale(HeldEventListMetric.AverageRankScale, RoundingMode.HALF_UP),
        (1 to 4).toList.map(rank => ranks.count(_ == rank)),
      )
    }.sortBy(_.memberId.value)
