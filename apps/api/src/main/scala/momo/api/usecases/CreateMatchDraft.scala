package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchDraftsRepository,
  SeasonMastersRepository,
}
import momo.api.usecases.syntax.MatchDraftForeignKeyValidation

final case class CreateMatchDraftCommand(
    heldEventId: Option[HeldEventId],
    matchNoInEvent: Option[Int],
    gameTitleId: Option[GameTitleId],
    layoutFamily: Option[String],
    seasonMasterId: Option[SeasonMasterId],
    ownerMemberId: Option[MemberId],
    mapMasterId: Option[MapMasterId],
    playedAt: Option[Instant],
    status: Option[MatchDraftStatus],
)

final class CreateMatchDraft[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    now: F[Instant],
    nextId: F[MatchDraftId],
):
  def run(
      command: CreateMatchDraftCommand,
      createdBy: AccountId,
      playerMemberId: Option[MemberId],
  ): F[Either[AppError, MatchDraft]] = (for
    matchNoInEvent <- EitherT.fromEither[F](validateMatchNo(command.matchNoInEvent))
    status <- EitherT.fromEither[F](validateInitialStatus(command.status))
    _ <- validateForeignKeys(command)
    id <- EitherT.liftF(nextId)
    at <- EitherT.liftF(now)
    draft <- EitherT.fromEither[F](
      MatchDraft.fromInputs(
        id = id,
        createdByAccountId = createdBy,
        createdByMemberId = playerMemberId,
        status = status,
        heldEventId = command.heldEventId,
        matchNoInEvent = matchNoInEvent,
        gameTitleId = command.gameTitleId,
        layoutFamily = command.layoutFamily,
        seasonMasterId = command.seasonMasterId,
        ownerMemberId = command.ownerMemberId,
        mapMasterId = command.mapMasterId,
        playedAt = command.playedAt,
        totalAssetsImageId = None,
        revenueImageId = None,
        incidentLogImageId = None,
        totalAssetsDraftId = None,
        revenueDraftId = None,
        incidentLogDraftId = None,
        sourceImagesRetainedUntil = None,
        sourceImagesDeletedAt = None,
        confirmedMatchId = None,
        createdAt = at,
        updatedAt = at,
      ).left.map(err => AppError.ValidationFailed(err.message))
    )
    _ <- EitherT.liftF(matchDrafts.create(draft))
  yield draft).value

  private def validateMatchNo(
      matchNoInEvent: Option[Int]
  ): Either[AppError, Option[MatchNoInEvent]] = matchNoInEvent.traverse(value =>
    MatchNoInEvent.fromInt(value).left.map(err => AppError.ValidationFailed(err.message))
  )

  private def validateInitialStatus(
      status: Option[MatchDraftStatus]
  ): Either[AppError, MatchDraftStatus] =
    val resolved = status.getOrElse(MatchDraftStatus.DraftReady)
    Either.cond(
      MatchDraftStatus.nonTerminalStatuses.contains(resolved),
      resolved,
      AppError.ValidationFailed(s"status ${resolved.wire} cannot be set when creating a draft."),
    )

  private def validateForeignKeys(command: CreateMatchDraftCommand): EitherT[F, AppError, Unit] =
    MatchDraftForeignKeyValidation.validate(heldEvents, gameTitles, mapMasters, seasonMasters)(
      MatchDraftForeignKeyValidation.Input(
        heldEventId = command.heldEventId,
        gameTitleId = command.gameTitleId,
        mapMasterId = command.mapMasterId,
        seasonMasterId = command.seasonMasterId,
      )
    )
