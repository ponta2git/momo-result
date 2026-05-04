package momo.api.usecases

import cats.data.{EitherNec, NonEmptyChain}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{FourPlayers, MatchValidationError, PlayerResult}
import momo.api.errors.AppError

/**
 * Shared shape validation for match confirm/update flows.
 *
 * Centralises the rules from `requirements/base.md` §3:
 *   - 4 unique members
 *   - play_order/rank ∈ {1..4} permutation
 *   - owner ∈ allowed member set
 *   - non-negative incident counts
 *
 * Phase 2 introduces an explicit [[MatchValidationError]] ADT and `EitherNec` accumulation so that
 * callers can surface every problem at once (instead of bailing on the first failure). The legacy
 * [[validateShape]] entry point is preserved as a thin shim returning `Either[AppError, Unit]` for
 * call sites that have not yet been migrated.
 */
object MatchValidation:

  /** Validation result type — accumulates errors via `cats.data.NonEmptyChain`. */
  type Validated[A] = EitherNec[MatchValidationError, A]

  final case class Input(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      players: List[PlayerResult],
  )

  /** A fully validated [[Input]] with [[FourPlayers]] guaranteed by construction. */
  final case class ValidatedInput(
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      ownerMemberId: MemberId,
      mapMasterId: MapMasterId,
      players: FourPlayers,
  )

  /**
   * Run all checks in parallel and accumulate errors. Returns either every detected problem or a
   * fully validated input with [[FourPlayers]] populated.
   */
  def validate(input: Input, allowedMemberIds: Set[MemberId]): Validated[ValidatedInput] = (
    validateHeldEventId(input.heldEventId),
    validateMatchNoInEvent(input.matchNoInEvent),
    validateGameTitleId(input.gameTitleId),
    validateSeasonMasterId(input.seasonMasterId),
    validateOwnerMemberId(input.ownerMemberId, allowedMemberIds),
    validateMapMasterId(input.mapMasterId),
    FourPlayers.fromList(input.players, allowedMemberIds),
  ).parMapN { (heldEventId, matchNo, gameTitleId, seasonId, owner, mapId, four) =>
    ValidatedInput(heldEventId, matchNo, gameTitleId, seasonId, owner, mapId, four)
  }

  /** Legacy shim retained for callers not yet migrated to the [[Validated]] form. */
  def validateShape(input: Input, allowedMemberIds: Set[MemberId]): Either[AppError, Unit] =
    validate(input, allowedMemberIds).bimap(toAppError, _ => ())

  /** Render an accumulated error chain as a single [[AppError.ValidationFailed]]. */
  def toAppError(errors: NonEmptyChain[MatchValidationError]): AppError = AppError
    .ValidationFailed(errors.toList.map(_.message).mkString("; "))

  private def validateHeldEventId(id: HeldEventId): Validated[HeldEventId] =
    if id.value.trim.isEmpty then MatchValidationError.HeldEventIdRequired.leftNec else id.rightNec

  private def validateMatchNoInEvent(value: Int): Validated[Int] =
    if value < 1 then MatchValidationError.MatchNoInEventInvalid(value).leftNec else value.rightNec

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

end MatchValidation
