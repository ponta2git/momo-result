package momo.api.usecases.matches

import java.time.Instant

import cats.Monad
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchPolicy, MatchRecord, MatchUpdate, PlayerResult}
import momo.api.errors.AppError
import momo.api.repositories.{
  EntityReferenceResolver,
  GameTitlesRepository,
  HeldEventsRepository,
  MapMastersRepository,
  MatchesRepository,
  SeasonMastersRepository
}
import momo.api.usecases.common.{MatchReferenceValidation, ReferenceNormalization}

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
    references: Option[EntityReferenceResolver[F]] = None,
):
  private val inputValidation = MatchInputValidation(
    MatchReferenceValidation(heldEvents, gameTitles, mapMasters, seasonMasters)
  )

  def run(matchId: MatchId, command: UpdateMatchCommand): F[Either[AppError, MatchRecord]] =
    ReferenceNormalization.update(
      command,
      references.getOrElse(EntityReferenceResolver.preserve[F])
    )
      .flatMap(normalized => runResolved(matchId, normalized))

  private def runResolved(
      matchId: MatchId,
      command: UpdateMatchCommand
  ): F[Either[AppError, MatchRecord]] = (for
    allowed <- EitherT.liftF(allowedMemberIds)
    validation <- inputValidation.validate(
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
    )
    (validated, title) = validation
    duplicate <- EitherT
      .liftF(matches.existsMatchNoExcept(command.heldEventId, validated.matchNoInEvent, matchId))
    _ <- EitherT.fromEither[F](
      if duplicate then
        Left(AppError.Conflict(s"matchNoInEvent ${command
            .matchNoInEvent} already exists for held event ${command.heldEventId}."))
      else Right(())
    )
    updatedAt <- EitherT.liftF(now)
    change = MatchUpdate(
      input = validated,
      layoutFamily = title.layoutFamily,
      playedAt = command.playedAt,
      totalAssetsDraftId = command.draftRefs.totalAssets,
      revenueDraftId = command.draftRefs.revenue,
      incidentLogDraftId = command.draftRefs.incidentLog,
    )
    record <- EitherT(matches.update(matchId, change, updatedAt))
  yield record).value
