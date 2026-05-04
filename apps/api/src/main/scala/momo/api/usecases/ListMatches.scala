package momo.api.usecases

import cats.Monad
import cats.data.EitherT

import momo.api.domain.MatchListItem
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.MatchListRepository

final case class ListMatchesCommand(
    heldEventId: Option[HeldEventId],
    gameTitleId: Option[GameTitleId],
    seasonMasterId: Option[SeasonMasterId],
    status: Option[String],
    kind: Option[String],
    limit: Option[Int],
)

final class ListMatches[F[_]: Monad](repository: MatchListRepository[F]):
  def run(command: ListMatchesCommand): F[Either[AppError, List[MatchListItem]]] = (for
    statusFilter <- EitherT.fromEither[F](parseStatus(command.status))
    kindFilter <- EitherT.fromEither[F](parseKind(command.kind))
    items <- EitherT.liftF(repository.list(MatchListRepository.Filter(
      heldEventId = command.heldEventId,
      gameTitleId = command.gameTitleId,
      seasonMasterId = command.seasonMasterId,
      status = statusFilter,
      kind = kindFilter,
      limit = command.limit,
    )))
  yield items).value

  private def parseStatus(
      status: Option[String]
  ): Either[AppError, MatchListRepository.StatusFilter] = status match
    case None | Some("all") => Right(MatchListRepository.StatusFilter.All)
    case Some("incomplete") => Right(MatchListRepository.StatusFilter.Incomplete)
    case Some("ocr_running") => Right(MatchListRepository.StatusFilter.OcrRunning)
    case Some("pre_confirm") => Right(MatchListRepository.StatusFilter.PreConfirm)
    case Some("needs_review") => Right(MatchListRepository.StatusFilter.NeedsReview)
    case Some("confirmed") => Right(MatchListRepository.StatusFilter.Confirmed)
    case Some(other) => Left(AppError.ValidationFailed(
        s"status must be all, incomplete, ocr_running, pre_confirm, needs_review, or confirmed: $other"
      ))

  private def parseKind(kind: Option[String]): Either[AppError, MatchListRepository.KindFilter] =
    kind match
      case None => Right(MatchListRepository.KindFilter.All)
      case Some("match") => Right(MatchListRepository.KindFilter.Match)
      case Some("match_draft") => Right(MatchListRepository.KindFilter.MatchDraft)
      case Some(other) =>
        Left(AppError.ValidationFailed(s"kind must be match or match_draft: $other"))
