package momo.api.domain

import java.time.Instant

final case class IncidentCounts(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int,
):
  def asMap: Map[String, Int] = IncidentCounts.toMap(this)

  /**
   * Yields (`incident_masters.id`, count) pairs in the order matching
   * `IncidentCounts.incidentMasterIds`. Used by the matches repository to insert the 6 required
   * `match_incidents` rows per player.
   */
  def asIncidentMasterIdMap: List[(String, Int)] = List(
    IncidentCounts.IdDestination -> destination,
    IncidentCounts.IdPlusStation -> plusStation,
    IncidentCounts.IdMinusStation -> minusStation,
    IncidentCounts.IdCardStation -> cardStation,
    IncidentCounts.IdCardShop -> cardShop,
    IncidentCounts.IdSuriNoGinji -> suriNoGinji,
  )

object IncidentCounts:
  /**
   * Stable IDs of the 6 fixed `incident_masters` rows. Must match the seed in
   * momo-db/drizzle/0008_foamy_nekra.sql.
   */
  val IdDestination = "incident_destination"
  val IdPlusStation = "incident_plus_station"
  val IdMinusStation = "incident_minus_station"
  val IdCardStation = "incident_card_station"
  val IdCardShop = "incident_card_shop"
  val IdSuriNoGinji = "incident_suri_no_ginji"

  val incidentMasterIds: List[String] =
    List(IdDestination, IdPlusStation, IdMinusStation, IdCardStation, IdCardShop, IdSuriNoGinji)

  val keys: List[String] = List("目的地", "プラス駅", "マイナス駅", "カード駅", "カード売り場", "スリの銀次")

  def toMap(c: IncidentCounts): Map[String, Int] = Map(
    "目的地" -> c.destination,
    "プラス駅" -> c.plusStation,
    "マイナス駅" -> c.minusStation,
    "カード駅" -> c.cardStation,
    "カード売り場" -> c.cardShop,
    "スリの銀次" -> c.suriNoGinji,
  )

final case class PlayerResult(
    memberId: String,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCounts,
)

final case class MatchRecord(
    id: String,
    heldEventId: String,
    matchNoInEvent: Int,
    gameTitleId: String,
    layoutFamily: String,
    seasonMasterId: String,
    ownerMemberId: String,
    mapMasterId: String,
    playedAt: Instant,
    totalAssetsDraftId: Option[String],
    revenueDraftId: Option[String],
    incidentLogDraftId: Option[String],
    players: List[PlayerResult],
    createdByMemberId: String,
    createdAt: Instant,
)
