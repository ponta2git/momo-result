package momo.api.usecases

import cats.data.EitherT
import cats.syntax.all.*
import cats.MonadThrow
import java.time.Instant
import momo.api.domain.{IncidentCounts, MatchRecord, PlayerResult}
import momo.api.domain.ids.{MemberId, *}
import momo.api.endpoints.{ConfirmMatchRequest, IncidentCountsRequest, PlayerResultRequest}
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

  def run(req: ConfirmMatchRequest, createdBy: MemberId): F[Either[AppError, MatchRecord]] = (for
    _ <- EitherT.fromEither[F](validateShape(req, allowedMemberIds))
    playedAt <- EitherT.fromEither[F](Try(Instant.parse(req.playedAt)).toEither.left.map(_ =>
      AppError.ValidationFailed("playedAt must be ISO8601 instant.")
    ))
    _ <- EitherT(heldEvents.find(req.heldEventId).map(_.toRight(
      AppError.NotFound("held event", req.heldEventId)
    )))
    title <- EitherT(gameTitles.find(req.gameTitleId).map(_.toRight(
      AppError.NotFound("game title", req.gameTitleId)
    )))
    mapMaster <- EitherT(mapMasters.find(req.mapMasterId).map(_.toRight(
      AppError.NotFound("map master", req.mapMasterId)
    )))
    _ <- EitherT.fromEither[F](
      if mapMaster.gameTitleId == title.id then Right(())
      else
        Left(AppError.ValidationFailed(s"mapMasterId ${mapMaster
            .id} does not belong to gameTitleId ${title.id}."))
    )
    season <- EitherT(seasonMasters.find(req.seasonMasterId).map(_.toRight(
      AppError.NotFound("season master", req.seasonMasterId)
    )))
    _ <- EitherT.fromEither[F](
      if season.gameTitleId == title.id then Right(())
      else
        Left(AppError.ValidationFailed(s"seasonMasterId ${season
            .id} does not belong to gameTitleId ${title.id}."))
    )
    duplicate <- EitherT.liftF(matches.existsMatchNo(req.heldEventId, req.matchNoInEvent))
    _ <- EitherT.fromEither[F](
      if duplicate then
        Left(AppError.Conflict(s"matchNoInEvent ${req
            .matchNoInEvent} already exists for held event ${req.heldEventId}."))
      else Right(())
    )
    id <- EitherT.liftF(nextId)
    createdAt <- EitherT.liftF(now)
    record = toRecord(id, createdAt, playedAt, title.layoutFamily, createdBy.value, req)
    _ <- EitherT.liftF(matches.create(record))
  yield record).value

object ConfirmMatch:
  private val expectedSet = Set(1, 2, 3, 4)

  private[usecases] def validateShape(
      req: ConfirmMatchRequest,
      allowedMemberIds: Set[String],
  ): Either[AppError, Unit] =
    def fail(msg: String): Either[AppError, Unit] = Left(AppError.ValidationFailed(msg))

    if req.heldEventId.trim.isEmpty then fail("heldEventId is required.")
    else if req.matchNoInEvent < 1 then fail("matchNoInEvent must be >= 1.")
    else if req.gameTitleId.trim.isEmpty then fail("gameTitleId is required.")
    else if req.seasonMasterId.trim.isEmpty then fail("seasonMasterId is required.")
    else if !allowedMemberIds.contains(req.ownerMemberId) then
      fail(s"ownerMemberId must be one of ${allowedMemberIds.mkString(", ")}.")
    else if req.mapMasterId.trim.isEmpty then fail("mapMasterId is required.")
    else if req.players.length != 4 then fail("players must contain exactly 4 entries.")
    else
      val members = req.players.map(_.memberId).toSet
      val playOrders = req.players.map(_.playOrder).toSet
      val ranks = req.players.map(_.rank).toSet
      if members.size != 4 then fail("player memberId must be unique.")
      else if !members.subsetOf(allowedMemberIds) then
        fail(s"player memberId must be a subset of ${allowedMemberIds.mkString(", ")}.")
      else if playOrders != expectedSet then
        fail("players.playOrder must be a permutation of {1,2,3,4}.")
      else if ranks != expectedSet then fail("players.rank must be a permutation of {1,2,3,4}.")
      else
        req.players.find(p => !validIncidentCounts(p)) match
          case Some(p) => fail(s"player ${p.memberId} has negative incident count.")
          case None => Right(())

  private def validIncidentCounts(p: PlayerResultRequest): Boolean = p.incidents.destination >= 0 &&
    p.incidents.plusStation >= 0 && p.incidents.minusStation >= 0 && p.incidents.cardStation >= 0 &&
    p.incidents.cardShop >= 0 && p.incidents.suriNoGinji >= 0

  private def toRecord(
      id: String,
      createdAt: Instant,
      playedAt: Instant,
      layoutFamily: String,
      createdByMemberId: String,
      req: ConfirmMatchRequest,
  ): MatchRecord = MatchRecord(
    id = id,
    heldEventId = req.heldEventId,
    matchNoInEvent = req.matchNoInEvent,
    gameTitleId = req.gameTitleId,
    layoutFamily = layoutFamily,
    seasonMasterId = req.seasonMasterId,
    ownerMemberId = req.ownerMemberId,
    mapMasterId = req.mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = req.draftIds.totalAssets,
    revenueDraftId = req.draftIds.revenue,
    incidentLogDraftId = req.draftIds.incidentLog,
    players = req.players.map(toPlayer),
    createdByMemberId = createdByMemberId,
    createdAt = createdAt,
  )

  private def toPlayer(p: PlayerResultRequest): PlayerResult = PlayerResult(
    memberId = p.memberId,
    playOrder = p.playOrder,
    rank = p.rank,
    totalAssetsManYen = p.totalAssetsManYen,
    revenueManYen = p.revenueManYen,
    incidents = toIncidents(p.incidents),
  )

  private def toIncidents(i: IncidentCountsRequest): IncidentCounts = IncidentCounts(
    destination = i.destination,
    plusStation = i.plusStation,
    minusStation = i.minusStation,
    cardStation = i.cardStation,
    cardShop = i.cardShop,
    suriNoGinji = i.suriNoGinji,
  )
