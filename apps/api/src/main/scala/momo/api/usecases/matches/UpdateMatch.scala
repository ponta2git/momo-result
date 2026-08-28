package momo.api.usecases.matches

import java.time.Instant

import cats.Monad
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchPolicy, MatchRecord, PlayerResult}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository,
  HeldEventsRepository,
  MapMastersRepository,
  MatchesRepository,
  SeasonMastersRepository
}
import momo.api.usecases.common.MatchReferenceValidation
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class UpdateMatchCommand(
    heldEventId: HeldEventId,
    matchNoInEvent: Int,
    gameTitleId: GameTitleId,
    seasonMasterId: SeasonMasterId,
    ownerMemberId: MemberId,
    mapMasterId: MapMasterId,
    playedAt: Instant,
    draftRefs: MatchDraftRefs,
    players: List[PlayerResult.Input],
)

final class UpdateMatch[F[_]: Monad](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    now: F[Instant],
    allowedMemberIds: F[Set[MemberId]],
):
  private val referenceValidation =
    MatchReferenceValidation(heldEvents, gameTitles, mapMasters, seasonMasters)

  def run(matchId: MatchId, command: UpdateMatchCommand): F[Either[AppError, MatchRecord]] = (for
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
    title <- referenceValidation.validateRequired(
      command.heldEventId,
      command.gameTitleId,
      command.mapMasterId,
      command.seasonMasterId,
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
    _ <- EitherT(matches.update(record, updatedAt))
  yield record).value
