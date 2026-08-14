package momo.api.usecases.matches

import cats.Monad
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  MatchListItem,
  MatchListKindFilter,
  MatchListSort,
  MatchListStatusFilter,
  MatchListSummary
}
import momo.api.errors.AppError
import momo.api.repositories.MatchListReadModel
import momo.api.usecases.common.ListPagination

final case class ListMatchesCommand(
    heldEventId: Option[HeldEventId],
    gameTitleId: Option[GameTitleId],
    seasonMasterId: Option[SeasonMasterId],
    status: MatchListStatusFilter,
    kind: MatchListKindFilter,
    pageSize: Option[Int],
    cursor: Option[String],
    sort: MatchListSort,
)

final case class ListMatchesPagination(
    page: Int,
    pageSize: Int,
    totalItems: Int,
    totalPages: Int,
    hasPreviousPage: Boolean,
    hasNextPage: Boolean,
    previousCursor: Option[String],
    nextCursor: Option[String],
    lastCursor: Option[String],
)

final case class ListMatchesResult(
    items: List[MatchListItem],
    pagination: ListMatchesPagination,
)

final class ListMatches[F[_]: Monad](repository: MatchListReadModel[F]):
  def run(
      command: ListMatchesCommand,
      accountId: AccountId,
  ): F[Either[AppError, ListMatchesResult]] = (for
    pageSize <- EitherT.fromEither[F](
      ListPagination.validatePageSize(command.pageSize, ListPagination.Matches)
    )
    scope = MatchListCursorCodec.Scope(
      accountId = accountId,
      heldEventId = command.heldEventId,
      gameTitleId = command.gameTitleId,
      seasonMasterId = command.seasonMasterId,
      status = command.status,
      kind = command.kind,
      sort = command.sort,
      pageSize = pageSize,
    )
    cursor <- EitherT.fromEither[F](command.cursor.traverse(MatchListCursorCodec.decode(_, scope)))
    items <- EitherT.liftF(repository.list(MatchListReadModel.Filter(
      heldEventId = command.heldEventId,
      gameTitleId = command.gameTitleId,
      seasonMasterId = command.seasonMasterId,
      status = command.status,
      kind = command.kind,
      page = MatchListReadModel.CursorPageRequest(pageSize = pageSize, cursor = cursor),
      sort = command.sort,
    )))
  yield ListMatchesResult(
    items = items.items,
    pagination = ListMatchesPagination(
      page = items.page,
      pageSize = items.pageSize,
      totalItems = items.totalItems,
      totalPages = items.totalPages,
      hasPreviousPage = items.hasPreviousPage,
      hasNextPage = items.hasNextPage,
      previousCursor = items.previousCursor.map(MatchListCursorCodec.encode(scope, _)),
      nextCursor = items.nextCursor.map(MatchListCursorCodec.encode(scope, _)),
      lastCursor = items.lastCursor.map(MatchListCursorCodec.encode(scope, _)),
    ),
  )).value

  def summarize(
      heldEventId: Option[HeldEventId],
      gameTitleId: Option[GameTitleId],
      seasonMasterId: Option[SeasonMasterId],
  ): F[Either[AppError, MatchListSummary]] = repository.summarize(MatchListReadModel.SummaryFilter(
    heldEventId = heldEventId,
    gameTitleId = gameTitleId,
    seasonMasterId = seasonMasterId,
  )).map(Right(_))
