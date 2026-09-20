package momo.api.usecases.heldevents

import cats.Applicative
import cats.syntax.all.*

import momo.api.domain.HeldEventListPage
import momo.api.errors.AppError
import momo.api.repositories.HeldEventListReadModel
import momo.api.usecases.common.ListPagination

final class ListHeldEvents[F[_]: Applicative](readModel: HeldEventListReadModel[F]):
  def run(
      query: Option[String],
      limit: Option[Int],
      page: Option[Int],
      pageSize: Option[Int],
  ): F[Either[AppError, HeldEventListPage]] =
    ListPagination.validate(page, pageSize, limit, ListPagination.HeldEvents)
      .traverse(readModel.list(query, _))
