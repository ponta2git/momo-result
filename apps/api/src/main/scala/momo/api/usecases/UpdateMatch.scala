package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import java.time.Instant
import momo.api.domain.MatchRecord
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchesRepository,
  SeasonMastersRepository,
}
import scala.util.Try

final class UpdateMatch[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    now: F[Instant],
    allowedMemberIds: Set[String],
):
  import UpdateMatch.*

  def run(matchId: String, command: Command): F[Either[AppError, MatchRecord]] = (for
    existing <- EitherT(matches.find(matchId).map(_.toRight(AppError.NotFound("match", matchId))))
    _ <- EitherT.fromEither[F](MatchValidation.validateShape(
      MatchValidation.Input(
        heldEventId = command.heldEventId,
        matchNoInEvent = command.matchNoInEvent,
        gameTitleId = command.gameTitleId,
        seasonMasterId = command.seasonMasterId,
        ownerMemberId = command.ownerMemberId,
        mapMasterId = command.mapMasterId,
        players = command.players,
      ),
      allowedMemberIds,
    ))
    playedAt <- EitherT.fromEither[F](Try(Instant.parse(command.playedAt)).toEither.left.map(_ =>
      AppError.ValidationFailed("playedAt must be ISO8601 instant.")
    ))
    _ <- EitherT(heldEvents.find(command.heldEventId).map(_.toRight(
      AppError.NotFound("held event", command.heldEventId)
    )))
    title <- EitherT(gameTitles.find(command.gameTitleId).map(_.toRight(
      AppError.NotFound("game title", command.gameTitleId)
    )))
    mapMaster <- EitherT(mapMasters.find(command.mapMasterId).map(_.toRight(
      AppError.NotFound("map master", command.mapMasterId)
    )))
    _ <- EitherT.fromEither[F](
      if mapMaster.gameTitleId == title.id then Right(())
      else
        Left(AppError.ValidationFailed(s"mapMasterId ${mapMaster
            .id} does not belong to gameTitleId ${title.id}."))
    )
    season <- EitherT(seasonMasters.find(command.seasonMasterId).map(_.toRight(
      AppError.NotFound("season master", command.seasonMasterId)
    )))
    _ <- EitherT.fromEither[F](
      if season.gameTitleId == title.id then Right(())
      else
        Left(AppError.ValidationFailed(s"seasonMasterId ${season
            .id} does not belong to gameTitleId ${title.id}."))
    )
    duplicate <- EitherT
      .liftF(matches.existsMatchNoExcept(command.heldEventId, command.matchNoInEvent, matchId))
    _ <- EitherT.fromEither[F](
      if duplicate then
        Left(AppError.Conflict(s"matchNoInEvent ${command
            .matchNoInEvent} already exists for held event ${command.heldEventId}."))
      else Right(())
    )
    updatedAt <- EitherT.liftF(now)
    record = existing.copy(
      heldEventId = command.heldEventId,
      matchNoInEvent = command.matchNoInEvent,
      gameTitleId = command.gameTitleId,
      layoutFamily = title.layoutFamily,
      seasonMasterId = command.seasonMasterId,
      ownerMemberId = command.ownerMemberId,
      mapMasterId = command.mapMasterId,
      playedAt = playedAt,
      // Preserve existing draft refs unless caller explicitly provides new ones.
      totalAssetsDraftId = command.draftRefs.totalAssets.orElse(existing.totalAssetsDraftId),
      revenueDraftId = command.draftRefs.revenue.orElse(existing.revenueDraftId),
      incidentLogDraftId = command.draftRefs.incidentLog.orElse(existing.incidentLogDraftId),
      players = command.players,
    )
    _ <- EitherT.liftF(matches.update(record, updatedAt))
  yield record).value

object UpdateMatch:
  final case class Command(
      heldEventId: String,
      matchNoInEvent: Int,
      gameTitleId: String,
      seasonMasterId: String,
      ownerMemberId: String,
      mapMasterId: String,
      playedAt: String,
      draftRefs: ConfirmMatch.DraftRefs,
      players: List[momo.api.domain.PlayerResult],
  )
