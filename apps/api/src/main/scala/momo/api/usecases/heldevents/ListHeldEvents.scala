package momo.api.usecases.heldevents

import cats.Applicative
import cats.syntax.all.*

import momo.api.domain.{HeldEventListPage, HeldEventListSearchCriteria, HeldEventListSort}
import momo.api.errors.AppError
import momo.api.repositories.HeldEventListReadModel
import momo.api.usecases.common.ListPagination

final case class ListHeldEventsCommand(
    limit: Option[Int],
    page: Option[Int],
    pageSize: Option[Int],
    sort: HeldEventListSort,
    search: HeldEventListSearchCriteria,
)

final class ListHeldEvents[F[_]: Applicative](readModel: HeldEventListReadModel[F]):
  def run(command: ListHeldEventsCommand): F[Either[AppError, HeldEventListPage]] = ListPagination
    .validate(command.page, command.pageSize, command.limit, ListPagination.HeldEvents)
    .traverse(readModel.list(command.search, command.sort, _))
