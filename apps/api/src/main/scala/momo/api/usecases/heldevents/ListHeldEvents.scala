package momo.api.usecases.heldevents

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{HeldEvent, PagedResult}
import momo.api.errors.AppError
import momo.api.repositories.{HeldEventsRepository, MatchDraftsRepository, MatchesRepository}
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
)

final class ListHeldEvents[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    drafts: MatchDraftsRepository[F],
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
            )
          },
          pagination = page,
          totalMatchCount = matchStats.values.map(_.matchCount).sum,
        ))
