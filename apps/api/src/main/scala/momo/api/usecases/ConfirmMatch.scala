package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import java.time.Instant
import momo.api.domain.{MatchRecord, PlayerResult}
import momo.api.domain.ids.{MemberId, *}
import momo.api.errors.AppError
import momo.api.repositories.{
  GameTitlesRepository, HeldEventsRepository, MapMastersRepository, MatchesRepository,
  SeasonMastersRepository,
}
import scala.util.Try

final class ConfirmMatch[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    gameTitles: GameTitlesRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    now: F[Instant],
    nextId: F[String],
    allowedMemberIds: Set[String],
):
  import ConfirmMatch.*

  def run(command: Command, createdBy: MemberId): F[Either[AppError, MatchRecord]] = (for
    _ <- EitherT.fromEither[F](validateShape(command, allowedMemberIds))
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
    _ <- EitherT.liftF(matches.create(record))
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
      draftRefs: DraftRefs,
      players: List[PlayerResult],
  )

  private val RequiredOrdinals = Set(1, 2, 3, 4)

  private[usecases] def validateShape(
      command: Command,
      allowedMemberIds: Set[String],
  ): Either[AppError, Unit] =
    def fail(msg: String): Either[AppError, Unit] = Left(AppError.ValidationFailed(msg))

    if command.heldEventId.trim.isEmpty then fail("heldEventId is required.")
    else if command.matchNoInEvent < 1 then fail("matchNoInEvent must be >= 1.")
    else if command.gameTitleId.trim.isEmpty then fail("gameTitleId is required.")
    else if command.seasonMasterId.trim.isEmpty then fail("seasonMasterId is required.")
    else if !allowedMemberIds.contains(command.ownerMemberId) then
      fail(s"ownerMemberId must be one of ${allowedMemberIds.mkString(", ")}.")
    else if command.mapMasterId.trim.isEmpty then fail("mapMasterId is required.")
    else if command.players.length != 4 then fail("players must contain exactly 4 entries.")
    else
      val members = command.players.map(_.memberId).toSet
      val playOrders = command.players.map(_.playOrder).toSet
      val ranks = command.players.map(_.rank).toSet
      if members.size != 4 then fail("player memberId must be unique.")
      else if !members.subsetOf(allowedMemberIds) then
        fail(s"player memberId must be a subset of ${allowedMemberIds.mkString(", ")}.")
      else if playOrders != RequiredOrdinals then
        fail("players.playOrder must be a permutation of {1,2,3,4}.")
      else if ranks != RequiredOrdinals then
        fail("players.rank must be a permutation of {1,2,3,4}.")
      else
        command.players.find(p => !hasNonNegativeIncidentCounts(p)) match
          case Some(p) => fail(s"player ${p.memberId} has negative incident count.")
          case None => Right(())

  private def hasNonNegativeIncidentCounts(p: PlayerResult): Boolean =
    p.incidents.destination >= 0 && p.incidents.plusStation >= 0 && p.incidents.minusStation >= 0 &&
      p.incidents.cardStation >= 0 && p.incidents.cardShop >= 0 && p.incidents.suriNoGinji >= 0

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
