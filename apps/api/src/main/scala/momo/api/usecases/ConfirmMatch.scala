package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import java.time.Instant
import momo.api.domain.{MatchRecord, PlayerResult}
import momo.api.domain.ids.{MemberId, *}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchConfirmationRepository,
  MatchDraftsRepository, MatchesRepository, SeasonMastersRepository,
}
import scala.util.Try

final class ConfirmMatch[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    matchDrafts: MatchDraftsRepository[F],
    confirmations: MatchConfirmationRepository[F],
    sourceImageRetention: SourceImageRetentionService[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    now: F[Instant],
    nextId: F[String],
    allowedMemberIds: Set[String],
):
  import ConfirmMatch.*

  def run(command: Command, createdBy: MemberId): F[Either[AppError, MatchRecord]] = (for
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
    duplicate <- EitherT.liftF(matches.existsMatchNo(command.heldEventId, command.matchNoInEvent))
    _ <- EitherT.fromEither[F](
      if duplicate then
        Left(AppError.Conflict(s"matchNoInEvent ${command
            .matchNoInEvent} already exists for held event ${command.heldEventId}."))
      else Right(())
    )
    id <- EitherT.liftF(nextId)
    createdAt <- EitherT.liftF(now)
    record = toMatchRecord(id, createdAt, playedAt, title.layoutFamily, createdBy.value, command)
    maybeDraft <- command.matchDraftId match
      case None => EitherT.rightT[F, AppError](Option.empty[momo.api.domain.MatchDraft])
      case Some(draftId) => EitherT(
          matchDrafts.find(draftId).map(_.toRight(AppError.NotFound("match draft", draftId)))
        ).flatMap { draft =>
          EitherT.fromEither[F](validateDraftForConfirm(draft, command.draftRefs))
            .map(_ => Some(draft))
        }
    saved <- EitherT.liftF(confirmations.confirm(record, maybeDraft.map(_.id), createdAt))
    _ <- EitherT.fromEither[F](
      Either.cond(saved, (), AppError.Conflict("Failed to confirm match from the draft."))
    )
    _ <- maybeDraft match
      case None => EitherT.rightT[F, AppError](())
      case Some(draft) => EitherT.liftF(sourceImageRetention.markForCleanup(draft.id, createdAt))
  yield record).value

object ConfirmMatch:
  final case class DraftRefs(
      totalAssets: Option[String],
      revenue: Option[String],
      incidentLog: Option[String],
  )

  final case class Command(
      heldEventId: String,
      matchNoInEvent: Int,
      gameTitleId: String,
      seasonMasterId: String,
      ownerMemberId: String,
      mapMasterId: String,
      playedAt: String,
      matchDraftId: Option[String],
      draftRefs: DraftRefs,
      players: List[PlayerResult],
  )

  private def toMatchRecord(
      id: String,
      createdAt: Instant,
      playedAt: Instant,
      layoutFamily: String,
      createdByMemberId: String,
      command: Command,
  ): MatchRecord = MatchRecord(
    id = id,
    heldEventId = command.heldEventId,
    matchNoInEvent = command.matchNoInEvent,
    gameTitleId = command.gameTitleId,
    layoutFamily = layoutFamily,
    seasonMasterId = command.seasonMasterId,
    ownerMemberId = command.ownerMemberId,
    mapMasterId = command.mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = command.draftRefs.totalAssets,
    revenueDraftId = command.draftRefs.revenue,
    incidentLogDraftId = command.draftRefs.incidentLog,
    players = command.players,
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
