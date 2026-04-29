package momo.api.domain

import java.time.Instant

final case class IncidentCounts(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int
):
  def asMap: Map[String, Int] = IncidentCounts.toMap(this)

object IncidentCounts:
  val keys: List[String] = List(
    "目的地",
    "プラス駅",
    "マイナス駅",
    "カード駅",
    "カード売り場",
    "スリの銀次"
  )

  def toMap(c: IncidentCounts): Map[String, Int] = Map(
    "目的地" -> c.destination,
    "プラス駅" -> c.plusStation,
    "マイナス駅" -> c.minusStation,
    "カード駅" -> c.cardStation,
    "カード売り場" -> c.cardShop,
    "スリの銀次" -> c.suriNoGinji
  )

final case class PlayerResult(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCounts
)

final case class MatchRecord(
    id: String,
    heldEventId: String,
    matchNoInEvent: Int,
    gameTitle: String,
    layoutFamily: String,
    seasonId: String,
    ownerMemberId: String,
    mapName: String,
    playedAt: Instant,
    totalAssetsDraftId: Option[String],
    revenueDraftId: Option[String],
    incidentLogDraftId: Option[String],
    players: List[PlayerResult],
    createdAt: Instant
)
