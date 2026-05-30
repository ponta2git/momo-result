package momo.api.usecases

import cats.Monad
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  MatchListItem, MatchListKindFilter, MatchListSort, MatchListStatusFilter, MatchListSummary,
  PagedResult,
}
import momo.api.errors.AppError
import momo.api.repositories.MatchListReadModel

final case class ListMatchesCommand(
    heldEventId: Option[HeldEventId],
    gameTitleId: Option[GameTitleId],
    seasonMasterId: Option[SeasonMasterId],
    status: MatchListStatusFilter,
    kind: MatchListKindFilter,
    limit: Option[Int],
    page: Option[Int],
    pageSize: Option[Int],
    sort: MatchListSort,
)

final class ListMatches[F[_]: Monad](repository: MatchListReadModel[F]):
  def run(command: ListMatchesCommand): F[Either[AppError, PagedResult[MatchListItem]]] = (for
    page <- EitherT.fromEither[F](
      ListPagination.validate(command.page, command.pageSize, command.limit, ListPagination.Matches)
    )
    items <- EitherT.liftF(repository.list(MatchListReadModel.Filter(
      heldEventId = command.heldEventId,
      gameTitleId = command.gameTitleId,
      seasonMasterId = command.seasonMasterId,
      status = command.status,
      kind = command.kind,
      page = page,
      sort = command.sort,
    )))
  yield items).value

  def summarize(
      heldEventId: Option[HeldEventId],
      gameTitleId: Option[GameTitleId],
      seasonMasterId: Option[SeasonMasterId],
  ): F[Either[AppError, MatchListSummary]] = repository.summarize(MatchListReadModel.SummaryFilter(
    heldEventId = heldEventId,
    gameTitleId = gameTitleId,
    seasonMasterId = seasonMasterId,
  )).map(Right(_))
