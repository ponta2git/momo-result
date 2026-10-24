package momo.api.domain

import java.time.{Instant, LocalDate}
import java.util.UUID

import momo.api.domain.ids.{AccountId, GameTitleId, MapMasterId, MatchId, MemberId}

enum AchievementRule(val wire: String) derives CanEqual:
  case Manual extends AchievementRule("manual")
  case TotalAssets extends AchievementRule("total_assets")
  case Destination extends AchievementRule("destination")
  case SuriNoGinji extends AchievementRule("suri_no_ginji")
  case EventAverageRank extends AchievementRule("event_average_rank")

object AchievementRule:
  def fromWire(value: String): Option[AchievementRule] = values.find(_.wire == value)

final case class AchievementItem(
    id: UUID,
    gameTitleId: GameTitleId,
    name: String,
    notes: String,
    common: Boolean,
    mapMasterIds: List[MapMasterId],
    rule: AchievementRule,
    threshold: Option[BigDecimal],
    stars: Int,
    appliesFrom: Option[LocalDate],
    retiredAt: Option[Instant],
    version: Long,
    fixedKey: Option[String],
)

final case class AchievementClaim(
    id: UUID,
    achievementId: UUID,
    memberId: MemberId,
    sourceKind: String,
    state: String,
    matchId: Option[MatchId],
    achievedAt: Option[Instant],
    generationId: UUID,
    version: Long,
    updatedByDisplayName: String,
    updatedAt: Instant,
)

final case class AchievementCatalog(
    gameTitleId: GameTitleId,
    items: List[AchievementItem],
    claims: List[AchievementClaim],
    members: List[(MemberId, String)],
    maps: List[(MapMasterId, String)],
)

final case class CreateAchievement(
    gameTitleId: GameTitleId,
    name: String,
    notes: String,
    common: Boolean,
    mapMasterIds: List[MapMasterId],
    rule: AchievementRule,
    threshold: Option[BigDecimal],
    stars: Int,
)

final case class UpdateAchievement(name: String, notes: String, stars: Int, expectedVersion: Long)

/** New declarations only. An absent root is represented by no expected version. */
final case class AddMatchAchievement(
    achievementId: UUID,
    memberId: MemberId,
    expectedItemVersion: Long,
    expectedClaimVersion: Option[Long],
)

/** Explicit correction of the same historical claim, preserving its generation identity. */
final case class CorrectAchievementClaim(
    expectedVersion: Long,
    expectedItemVersion: Long,
    state: String,
    matchId: Option[MatchId],
    achievedAt: Option[Instant],
    expectedMatchVersion: Option[Long],
)

final case class AddMatchAchievements(
    expectedMatchVersion: Long,
    achievements: List[AddMatchAchievement],
)

final case class AchievementMutationContext(accountId: AccountId, at: Instant)

final case class InitialAchievementItem(id: UUID, fixedKey: String, definition: CreateAchievement)
final case class InitialAchievementClaim(achievementId: UUID, memberId: MemberId, state: String)
final case class AchievementInitialization(
    items: List[InitialAchievementItem],
    claims: List[InitialAchievementClaim],
)
