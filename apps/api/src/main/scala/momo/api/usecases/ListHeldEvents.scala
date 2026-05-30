package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{HeldEvent, PagedResult}
import momo.api.errors.AppError
import momo.api.repositories.{HeldEventsRepository, MatchesRepository}

final case class HeldEventListResult(
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
  ): F[Either[AppError, HeldEventListResult]] =
    ListPagination.validate(page, pageSize, limit, ListPagination.HeldEvents) match
      case Left(error) => Monad[F].pure(Left(error))
      case Right(validPage) =>
        for
          page <- events.listPage(query, validPage)
          counts <- matches.countByHeldEvents(page.items.map(_.id))
          allIds <- events.listIds(query)
          allCounts <- matches.countByHeldEvents(allIds)
        yield Right(HeldEventListResult(
          items = page.items.map(e => e -> counts.getOrElse(e.id, 0)),
          pagination = page,
          totalMatchCount = allCounts.values.sum,
        ))
