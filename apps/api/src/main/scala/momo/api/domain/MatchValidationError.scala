package momo.api.domain

import momo.api.domain.ids.MemberId

/**
 * Domain-level validation errors produced by [[MatchValidation]] and [[momo.api.domain.FourPlayers]].
 *
 * Kept as a sealed ADT (not raw strings) so that future formatting / i18n / error-code mapping
 * has a single point of customisation. Each case knows how to render itself via [[message]].
 */
sealed trait MatchValidationError derives CanEqual:
  def message: String

object MatchValidationError:
  case object HeldEventIdRequired extends MatchValidationError:
    val message = "heldEventId is required."

  final case class MatchNoInEventInvalid(actual: Int) extends MatchValidationError:
    val message = s"matchNoInEvent must be >= 1 (was $actual)."

  case object GameTitleIdRequired extends MatchValidationError:
    val message = "gameTitleId is required."

  case object SeasonMasterIdRequired extends MatchValidationError:
    val message = "seasonMasterId is required."

  case object MapMasterIdRequired extends MatchValidationError:
    val message = "mapMasterId is required."

  final case class OwnerMemberIdNotAllowed(actual: MemberId, allowed: Set[MemberId])
      extends MatchValidationError:
    val message =
      s"ownerMemberId must be one of ${allowed.toList.map(_.value).sorted.mkString(", ")}."

  final case class PlayerCountMismatch(actual: Int) extends MatchValidationError:
    val message = s"players must contain exactly 4 entries (was $actual)."

  case object PlayerMemberIdsNotUnique extends MatchValidationError:
    val message = "player memberId must be unique."

  final case class PlayerMemberIdsNotAllowed(actual: Set[MemberId], allowed: Set[MemberId])
      extends MatchValidationError:
    val message =
      s"player memberId must be a subset of ${allowed.toList.map(_.value).sorted.mkString(", ")}."

  case object PlayOrdersNotPermutation extends MatchValidationError:
    val message = "players.playOrder must be a permutation of {1,2,3,4}."

  case object RanksNotPermutation extends MatchValidationError:
    val message = "players.rank must be a permutation of {1,2,3,4}."

  final case class IncidentCountsNegative(memberId: MemberId) extends MatchValidationError:
    val message = s"player ${memberId.value} has negative incident count."

end MatchValidationError
