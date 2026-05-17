package momo.api.usecases

import cats.Monad
import cats.data.EitherT

import momo.api.domain.ids.*
import momo.api.domain.{MatchListItem, MatchListKindFilter, MatchListStatusFilter}
import momo.api.errors.AppError
import momo.api.repositories.MatchListReadModel

final case class ListMatchesCommand(
    heldEventId: Option[HeldEventId],
    gameTitleId: Option[GameTitleId],
    seasonMasterId: Option[SeasonMasterId],
    status: MatchListStatusFilter,
    kind: MatchListKindFilter,
    limit: Option[Int],
)

final class ListMatches[F[_]: Monad](repository: MatchListReadModel[F]):
  def run(command: ListMatchesCommand): F[Either[AppError, List[MatchListItem]]] = (for
    limit <- EitherT.fromEither[F](ListLimit.validate("limit", command.limit, ListLimit.Matches))
    items <- EitherT.liftF(repository.list(MatchListReadModel.Filter(
      heldEventId = command.heldEventId,
      gameTitleId = command.gameTitleId,
      seasonMasterId = command.seasonMasterId,
      status = command.status,
      kind = command.kind,
      limit = Some(limit),
    )))
  yield items).value
