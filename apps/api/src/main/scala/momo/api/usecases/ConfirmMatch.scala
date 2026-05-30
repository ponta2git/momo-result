package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{MatchPolicy, MatchRecord, PlayerResult}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchConfirmationRepository,
  MatchDraftConfirmation, MatchDraftsRepository, MatchesRepository, SeasonMastersRepository,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final class ConfirmMatch[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    confirmations: MatchConfirmationRepository[F],
    sourceImageRetention: PurgeSourceImages[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    now: F[Instant],
    nextId: F[MatchId],
    allowedMemberIds: F[Set[MemberId]],
):
  import ConfirmMatch.*

  def run(
      command: Command,
      createdBy: AccountId,
      playerMemberId: Option[MemberId],
  ): F[Either[AppError, MatchRecord]] = (for
    allowed <- EitherT.liftF(allowedMemberIds)
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
    duplicate <- EitherT.liftF(matches.existsMatchNo(command.heldEventId, validated.matchNoInEvent))
    _ <- EitherT.fromEither[F](
      if duplicate then
        Left(AppError.Conflict(s"matchNoInEvent ${command
            .matchNoInEvent} already exists for held event ${command.heldEventId.value}."))
      else Right(())
    )
    id <- EitherT.liftF(nextId)
    createdAt <- EitherT.liftF(now)
    record = toMatchRecord(
      id,
      createdAt,
      command.playedAt,
      title.layoutFamily,
      createdBy,
      playerMemberId,
      command,
      validated,
    )
    maybeDraft <- command.matchDraftId match
      case None => EitherT.rightT[F, AppError](Option.empty[momo.api.domain.MatchDraft])
      case Some(draftId) => matchDrafts.find(draftId).orNotFound("match draft", draftId.value)
          .flatMap { draft =>
            EitherT.fromEither[F](validateDraftForConfirm(draft, command.draftRefs))
              .map(_ => Some(draft))
          }
    _ <- confirmations.confirm(record, maybeDraft.map(MatchDraftConfirmation.from), createdAt)
      .ensureF(AppError.Conflict("Failed to confirm match from the draft."))
    _ <- maybeDraft match
      case None => EitherT.rightT[F, AppError](())
      case Some(draft) => EitherT.liftF(sourceImageRetention.runBestEffort(draft.id, createdAt))
  yield record).value

object ConfirmMatch:
  final case class DraftRefs(
      totalAssets: Option[OcrDraftId],
      revenue: Option[OcrDraftId],
      incidentLog: Option[OcrDraftId],
  )

  final case class Command(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      playedAt: Instant,
      matchDraftId: Option[MatchDraftId],
      draftRefs: DraftRefs,
      players: List[PlayerResult.Input],
  )

  private def toMatchRecord(
      id: MatchId,
      createdAt: Instant,
      playedAt: Instant,
      layoutFamily: String,
      createdByAccountId: AccountId,
      createdByMemberId: Option[MemberId],
      command: Command,
      validated: MatchRecord.ValidatedInput,
  ): MatchRecord = MatchRecord(
    id = id,
    heldEventId = validated.heldEventId,
    matchNoInEvent = validated.matchNoInEvent,
    gameTitleId = validated.gameTitleId,
    layoutFamily = layoutFamily,
    seasonMasterId = validated.seasonMasterId,
    ownerMemberId = validated.ownerMemberId,
    mapMasterId = validated.mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = command.draftRefs.totalAssets,
    revenueDraftId = command.draftRefs.revenue,
    incidentLogDraftId = command.draftRefs.incidentLog,
    players = validated.players,
    createdByAccountId = createdByAccountId,
    createdByMemberId = createdByMemberId,
    createdAt = createdAt,
  )

  private def validateDraftForConfirm(
      draft: momo.api.domain.MatchDraft,
      draftRefs: DraftRefs,
  ): Either[AppError, Unit] =
    val allowedStatuses = Set(
      momo.api.domain.MatchDraftStatus.DraftReady,
      momo.api.domain.MatchDraftStatus.NeedsReview,
      momo.api.domain.MatchDraftStatus.OcrFailed,
    )
    if !allowedStatuses.contains(draft.status) then
      Left(AppError.Conflict(s"match draft in status=${draft.status.wire} cannot be confirmed."))
    else if draft.totalAssetsDraftId != draftRefs.totalAssets then
      Left(
        AppError.ValidationFailed("draftIds.totalAssets does not match the match draft snapshot.")
      )
    else if draft.revenueDraftId != draftRefs.revenue then
      Left(AppError.ValidationFailed("draftIds.revenue does not match the match draft snapshot."))
    else if draft.incidentLogDraftId != draftRefs.incidentLog then
      Left(
        AppError.ValidationFailed("draftIds.incidentLog does not match the match draft snapshot.")
      )
    else Right(())
