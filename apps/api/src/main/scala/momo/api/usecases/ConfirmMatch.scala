package momo.api.usecases

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*
import momo.api.domain.IncidentCounts
import momo.api.domain.MatchRecord
import momo.api.domain.PlayerResult
import momo.api.endpoints.ConfirmMatchDraftIds
import momo.api.endpoints.ConfirmMatchRequest
import momo.api.endpoints.IncidentCountsRequest
import momo.api.endpoints.PlayerResultRequest
import momo.api.errors.AppError
import momo.api.repositories.HeldEventsRepository
import momo.api.repositories.MatchesRepository

import java.time.Instant
import scala.util.Try

final class ConfirmMatch[F[_]: MonadThrow](
    heldEvents: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    now: F[Instant],
    nextId: F[String],
    allowedMemberIds: Set[String],
    allowedLayoutFamilies: Set[String]
):
  import ConfirmMatch.*

  def run(req: ConfirmMatchRequest): F[Either[AppError, MatchRecord]] =
    (for
      _ <- EitherT.fromEither[F](validateShape(req, allowedMemberIds, allowedLayoutFamilies))
      playedAt <- EitherT.fromEither[F](
        Try(Instant.parse(req.playedAt)).toEither.left
          .map(_ => AppError.ValidationFailed("playedAt must be ISO8601 instant."))
      )
      _ <- EitherT(
        heldEvents
          .find(req.heldEventId)
          .map(_.toRight(AppError.NotFound("held event", req.heldEventId)))
      )
      duplicate <- EitherT.liftF(matches.existsMatchNo(req.heldEventId, req.matchNoInEvent))
      _ <- EitherT.fromEither[F](
        if duplicate then
          Left(
            AppError.Conflict(
              s"matchNoInEvent ${req.matchNoInEvent} already exists for held event ${req.heldEventId}."
            )
          )
        else Right(())
      )
      id <- EitherT.liftF(nextId)
      createdAt <- EitherT.liftF(now)
      record = toRecord(id, createdAt, playedAt, req)
      _ <- EitherT.liftF(matches.create(record))
      _ <- EitherT.liftF(heldEvents.incrementMatchCount(req.heldEventId))
    yield record).value

object ConfirmMatch:
  private val expectedSet = Set(1, 2, 3, 4)

  private[usecases] def validateShape(
      req: ConfirmMatchRequest,
      allowedMemberIds: Set[String],
      allowedLayoutFamilies: Set[String]
  ): Either[AppError, Unit] =
    def fail(msg: String): Either[AppError, Unit] = Left(AppError.ValidationFailed(msg))

    if req.heldEventId.trim.isEmpty then fail("heldEventId is required.")
    else if req.matchNoInEvent < 1 then fail("matchNoInEvent must be >= 1.")
    else if req.gameTitle.trim.isEmpty then fail("gameTitle is required.")
    else if !allowedLayoutFamilies.contains(req.layoutFamily) then
      fail(s"layoutFamily must be one of ${allowedLayoutFamilies.mkString(", ")}.")
    else if req.seasonId.trim.isEmpty then fail("seasonId is required.")
    else if !allowedMemberIds.contains(req.ownerMemberId) then
      fail(s"ownerMemberId must be one of ${allowedMemberIds.mkString(", ")}.")
    else if req.mapName.trim.isEmpty then fail("mapName is required.")
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
        req.players.find(p => !validNonNeg(p)) match
          case Some(p) =>
            fail(
              s"player ${p.memberId} has negative totalAssetsManYen / revenueManYen / incident count."
            )
          case None => Right(())

  private def validNonNeg(p: PlayerResultRequest): Boolean =
    p.totalAssetsManYen >= 0 &&
      p.revenueManYen >= 0 &&
      p.incidents.destination >= 0 &&
      p.incidents.plusStation >= 0 &&
      p.incidents.minusStation >= 0 &&
      p.incidents.cardStation >= 0 &&
      p.incidents.cardShop >= 0 &&
      p.incidents.suriNoGinji >= 0

  private def toRecord(
      id: String,
      createdAt: Instant,
      playedAt: Instant,
      req: ConfirmMatchRequest
  ): MatchRecord =
    MatchRecord(
      id = id,
      heldEventId = req.heldEventId,
      matchNoInEvent = req.matchNoInEvent,
      gameTitle = req.gameTitle,
      layoutFamily = req.layoutFamily,
      seasonId = req.seasonId,
      ownerMemberId = req.ownerMemberId,
      mapName = req.mapName,
      playedAt = playedAt,
      totalAssetsDraftId = req.draftIds.totalAssets,
      revenueDraftId = req.draftIds.revenue,
      incidentLogDraftId = req.draftIds.incidentLog,
      players = req.players.map(toPlayer),
      createdAt = createdAt
    )

  private def toPlayer(p: PlayerResultRequest): PlayerResult =
    PlayerResult(
      memberId = p.memberId,
      playOrder = p.playOrder,
      rank = p.rank,
      totalAssetsManYen = p.totalAssetsManYen,
      revenueManYen = p.revenueManYen,
      incidents = toIncidents(p.incidents)
    )

  private def toIncidents(i: IncidentCountsRequest): IncidentCounts =
    IncidentCounts(
      destination = i.destination,
      plusStation = i.plusStation,
      minusStation = i.minusStation,
      cardStation = i.cardStation,
      cardShop = i.cardShop,
      suriNoGinji = i.suriNoGinji
    )
