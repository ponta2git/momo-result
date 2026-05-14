package momo.api.domain

import cats.data.{EitherNec, NonEmptyChain}
import cats.syntax.all.*

import momo.api.domain.ids.*

object MatchPolicy:
  type Validated[A] = EitherNec[MatchValidationError, A]

  final case class Input(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      players: List[PlayerResult.Input],
  )

  def validate(
      input: Input,
      allowedMemberIds: Set[MemberId],
  ): Validated[MatchRecord.ValidatedInput] = (
    validateHeldEventId(input.heldEventId),
    MatchNoInEvent.fromInt(input.matchNoInEvent).toEitherNec,
    validateGameTitleId(input.gameTitleId),
    validateSeasonMasterId(input.seasonMasterId),
    validateOwnerMemberId(input.ownerMemberId, allowedMemberIds),
    validateMapMasterId(input.mapMasterId),
    validatePlayers(input.players, allowedMemberIds),
  ).parMapN { (heldEventId, matchNo, gameTitleId, seasonId, owner, mapId, players) =>
    MatchRecord.ValidatedInput(
      heldEventId = heldEventId,
      matchNoInEvent = matchNo,
      gameTitleId = gameTitleId,
      seasonMasterId = seasonId,
      ownerMemberId = owner,
      mapMasterId = mapId,
      players = players,
    )
  }

  def toMessage(errors: NonEmptyChain[MatchValidationError]): String = errors.toList.map(_.message)
    .mkString("; ")

  private def validatePlayers(
      players: List[PlayerResult.Input],
      allowedMemberIds: Set[MemberId],
  ): Validated[FourPlayers] = players.traverse(PlayerResult.fromInput)
    .flatMap(FourPlayers.fromList(_, allowedMemberIds))

  private def validateHeldEventId(id: HeldEventId): Validated[HeldEventId] =
    if id.value.trim.isEmpty then MatchValidationError.HeldEventIdRequired.leftNec else id.rightNec

  private def validateGameTitleId(id: GameTitleId): Validated[GameTitleId] =
    if id.value.trim.isEmpty then MatchValidationError.GameTitleIdRequired.leftNec else id.rightNec

  private def validateSeasonMasterId(id: SeasonMasterId): Validated[SeasonMasterId] =
    if id.value.trim.isEmpty then MatchValidationError.SeasonMasterIdRequired.leftNec
    else id.rightNec

  private def validateOwnerMemberId(id: MemberId, allowed: Set[MemberId]): Validated[MemberId] =
    if allowed.contains(id) then id.rightNec
    else MatchValidationError.OwnerMemberIdNotAllowed(id, allowed).leftNec

  private def validateMapMasterId(id: MapMasterId): Validated[MapMasterId] =
    if id.value.trim.isEmpty then MatchValidationError.MapMasterIdRequired.leftNec else id.rightNec
end MatchPolicy
