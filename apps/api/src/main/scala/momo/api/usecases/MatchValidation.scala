package momo.api.usecases

import momo.api.domain.PlayerResult
import momo.api.errors.AppError

/**
 * Shared shape validation for match confirm/update flows. Centralises the rules from
 * `requirements/base.md` §3 (4 unique members, play_order/rank ∈ {1..4} permutation, owner ∈
 * allowed member set, non-negative incident counts).
 */
object MatchValidation:
  final case class Input(
      heldEventId: String,
      matchNoInEvent: Int,
      gameTitleId: String,
      seasonMasterId: String,
      ownerMemberId: String,
      mapMasterId: String,
      players: List[PlayerResult],
  )

  private val RequiredOrdinals = Set(1, 2, 3, 4)

  def validateShape(input: Input, allowedMemberIds: Set[String]): Either[AppError, Unit] =
    def fail(msg: String): Either[AppError, Unit] = Left(AppError.ValidationFailed(msg))

    if input.heldEventId.trim.isEmpty then fail("heldEventId is required.")
    else if input.matchNoInEvent < 1 then fail("matchNoInEvent must be >= 1.")
    else if input.gameTitleId.trim.isEmpty then fail("gameTitleId is required.")
    else if input.seasonMasterId.trim.isEmpty then fail("seasonMasterId is required.")
    else if !allowedMemberIds.contains(input.ownerMemberId) then
      fail(s"ownerMemberId must be one of ${allowedMemberIds.mkString(", ")}.")
    else if input.mapMasterId.trim.isEmpty then fail("mapMasterId is required.")
    else if input.players.length != 4 then fail("players must contain exactly 4 entries.")
    else
      val members = input.players.map(_.memberId).toSet
      val playOrders = input.players.map(_.playOrder).toSet
      val ranks = input.players.map(_.rank).toSet
      if members.size != 4 then fail("player memberId must be unique.")
      else if !members.subsetOf(allowedMemberIds) then
        fail(s"player memberId must be a subset of ${allowedMemberIds.mkString(", ")}.")
      else if playOrders != RequiredOrdinals then
        fail("players.playOrder must be a permutation of {1,2,3,4}.")
      else if ranks != RequiredOrdinals then
        fail("players.rank must be a permutation of {1,2,3,4}.")
      else
        input.players.find(p => !hasNonNegativeIncidentCounts(p)) match
          case Some(p) => fail(s"player ${p.memberId} has negative incident count.")
          case None => Right(())

  private def hasNonNegativeIncidentCounts(p: PlayerResult): Boolean =
    p.incidents.destination >= 0 && p.incidents.plusStation >= 0 && p.incidents.minusStation >= 0 &&
      p.incidents.cardStation >= 0 && p.incidents.cardShop >= 0 && p.incidents.suriNoGinji >= 0
