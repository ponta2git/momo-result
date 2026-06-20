package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchPolicy, MatchRecord, PlayerResult}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchesRepository,
  SeasonMastersRepository,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final class UpdateMatch[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    now: F[Instant],
    allowedMemberIds: F[Set[MemberId]],
):
  import UpdateMatch.*

  def run(matchId: MatchId, command: Command): F[Either[AppError, MatchRecord]] = (for
    allowed <- EitherT.liftF(allowedMemberIds)
    existing <- matches.find(matchId).orNotFound("match", matchId.value)
    validated <- EitherT.fromEither[F](
      MatchPolicy.validate(
        MatchPolicy.Input(
          heldEventId = command.heldEventId,
          matchNoInEvent = command.matchNoInEvent,
          gameTitleId = command.gameTitleId,
          seasonMasterId = command.seasonMasterId,
          ownerMemberId = command.ownerMemberId,
          mapMasterId = command.mapMasterId,
          players = command.players,
        ),
        allowed,
      ).leftMap(errors => AppError.ValidationFailed(MatchPolicy.toMessage(errors)))
    )
    _ <- heldEvents.find(command.heldEventId).orNotFound("held event", command.heldEventId.value)
      .void
    title <- gameTitles.find(command.gameTitleId)
      .orNotFound("game title", command.gameTitleId.value)
    mapMaster <- mapMasters.find(command.mapMasterId)
      .orNotFound("map master", command.mapMasterId.value)
    _ <- EitherT.fromEither[F](
      if mapMaster.gameTitleId == title.id then Right(())
      else
        Left(AppError.ValidationFailed(s"mapMasterId ${mapMaster
            .id} does not belong to gameTitleId ${title.id}."))
    )
    season <- seasonMasters.find(command.seasonMasterId)
      .orNotFound("season master", command.seasonMasterId.value)
    _ <- EitherT.fromEither[F](
      if season.gameTitleId == title.id then Right(())
      else
        Left(AppError.ValidationFailed(s"seasonMasterId ${season
            .id} does not belong to gameTitleId ${title.id}."))
    )
    duplicate <- EitherT
      .liftF(matches.existsMatchNoExcept(command.heldEventId, validated.matchNoInEvent, matchId))
    _ <- EitherT.fromEither[F](
      if duplicate then
        Left(AppError.Conflict(s"matchNoInEvent ${command
            .matchNoInEvent} already exists for held event ${command.heldEventId}."))
      else Right(())
    )
    updatedAt <- EitherT.liftF(now)
    record = existing.copy(
      heldEventId = validated.heldEventId,
      matchNoInEvent = validated.matchNoInEvent,
      gameTitleId = validated.gameTitleId,
      layoutFamily = title.layoutFamily,
      seasonMasterId = validated.seasonMasterId,
      ownerMemberId = validated.ownerMemberId,
      mapMasterId = validated.mapMasterId,
      playedAt = command.playedAt,
      // Preserve existing draft refs unless caller explicitly provides new ones.
      totalAssetsDraftId = command.draftRefs.totalAssets.orElse(existing.totalAssetsDraftId),
      revenueDraftId = command.draftRefs.revenue.orElse(existing.revenueDraftId),
      incidentLogDraftId = command.draftRefs.incidentLog.orElse(existing.incidentLogDraftId),
      players = validated.players,
    )
    _ <- matches.update(record, updatedAt).recoverAppError
  yield record).value

object UpdateMatch:
  final case class Command(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      playedAt: Instant,
      draftRefs: ConfirmMatch.DraftRefs,
      players: List[PlayerResult.Input],
  )
