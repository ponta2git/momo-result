package momo.api.usecases.heldevents

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{HeldEvent, PagedResult}
import momo.api.errors.AppError
import momo.api.repositories.{HeldEventsRepository, MatchesRepository}
import momo.api.usecases.common.ListPagination

final case class HeldEventListPage(
    items: List[(HeldEvent, Int)],
    pagination: PagedResult[HeldEvent],
    totalMatchCount: Int,
)

final class ListHeldEvents[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
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
          counts <- matches.countByHeldEvents(page.items.map(_.id))
          allIds <- events.listIds(query)
          allCounts <- matches.countByHeldEvents(allIds)
        yield Right(HeldEventListPage(
          items = page.items.map(e => e -> counts.getOrElse(e.id, 0)),
          pagination = page,
          totalMatchCount = allCounts.values.sum,
        ))
