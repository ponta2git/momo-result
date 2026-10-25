package momo.api.endpoints

import io.circe.Codec

import momo.api.domain.{AchievementCatalog, AchievementClaim, AchievementItem}

final case class AchievementItemResponse(
    achievementId: String,
    gameTitleId: String,
    name: String,
    notes: String,
    common: Boolean,
    mapMasterIds: List[String],
    ruleKind: String,
    threshold: Option[String],
    stars: Int,
    sortOrder: Int,
    appliesFrom: Option[String],
    retiredAt: Option[String],
    version: String,
) derives Codec.AsObject

object AchievementItemResponse:
  def from(value: AchievementItem): AchievementItemResponse = AchievementItemResponse(
    value.id.toString,
    value.gameTitleId.value,
    value.name,
    value.notes,
    value.common,
    value.mapMasterIds.map(_.value),
    value.rule.wire,
    value.threshold.map(_.bigDecimal.stripTrailingZeros.toPlainString),
    value.stars,
    value.sortOrder,
    value.appliesFrom.map(_.toString),
    value.retiredAt.map(_.toString),
    value.version.toString,
  )

final case class AchievementClaimResponse(
    claimId: String,
    achievementId: String,
    memberId: String,
    sourceKind: String,
    state: String,
    matchId: Option[String],
    achievedAt: Option[String],
    generationId: String,
    version: String,
    updatedByDisplayName: String,
    updatedAt: String,
) derives Codec.AsObject

object AchievementClaimResponse:
  def from(value: AchievementClaim): AchievementClaimResponse = AchievementClaimResponse(
    value.id.toString,
    value.achievementId.toString,
    value.memberId.value,
    value.sourceKind,
    value.state,
    value.matchId.map(_.value),
    value.achievedAt.map(_.toString),
    value.generationId.toString,
    value.version.toString,
    value.updatedByDisplayName,
    value.updatedAt.toString,
  )

final case class AchievementMemberResponse(memberId: String, displayName: String)
    derives Codec.AsObject

final case class AchievementMapResponse(mapMasterId: String, displayName: String)
    derives Codec.AsObject

final case class AchievementCatalogResponse(
    gameTitleId: String,
    orderRevision: String,
    items: List[AchievementItemResponse],
    claims: List[AchievementClaimResponse],
    members: List[AchievementMemberResponse],
    maps: List[AchievementMapResponse],
) derives Codec.AsObject

object AchievementCatalogResponse:
  def from(value: AchievementCatalog): AchievementCatalogResponse = AchievementCatalogResponse(
    value.gameTitleId.value,
    value.orderRevision,
    value.items.map(AchievementItemResponse.from),
    value.claims.map(AchievementClaimResponse.from),
    value.members.map((id, name) => AchievementMemberResponse(id.value, name)),
    value.maps.map((id, name) => AchievementMapResponse(id.value, name)),
  )

final case class CreateAchievementRequest(
    gameTitleId: String,
    name: String,
    notes: String,
    common: Boolean,
    mapMasterIds: List[String],
    ruleKind: String,
    threshold: Option[String],
    stars: Int,
) derives Codec.AsObject

final case class UpdateAchievementRequest(
    name: String,
    notes: String,
    stars: Int,
    expectedVersion: String,
) derives Codec.AsObject

final case class RetireAchievementRequest(expectedVersion: String) derives Codec.AsObject

final case class ReorderAchievementsRequest(
    gameTitleId: String,
    expectedOrderRevision: String,
    achievementIds: List[String],
) derives Codec.AsObject

final case class AddMatchAchievementRequest(
    achievementId: String,
    memberId: String,
    expectedItemVersion: String,
    expectedClaimVersion: Option[String],
) derives Codec.AsObject

final case class AddMatchAchievementsRequest(
    expectedMatchVersion: String,
    achievements: List[AddMatchAchievementRequest],
) derives Codec.AsObject

final case class CorrectAchievementClaimRequest(
    expectedVersion: String,
    expectedItemVersion: String,
    state: String,
    matchId: Option[String],
    achievedAt: Option[String],
    expectedMatchVersion: Option[String],
) derives Codec.AsObject

final case class AchievementSavedResponse(saved: Boolean) derives Codec.AsObject
