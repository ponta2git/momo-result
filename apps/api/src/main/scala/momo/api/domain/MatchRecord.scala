package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

final case class IncidentCounts(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int,
):
  /**
   * Pairs each count with its `incident_masters.id` in the canonical order. Used by the matches
   * repository to insert the 6 required `match_incidents` rows per player.
   */
  def entriesByMasterId: List[(IncidentMasterId, Int)] = List(
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
  val IdDestination: IncidentMasterId = IncidentMasterId("incident_destination")
  val IdPlusStation: IncidentMasterId = IncidentMasterId("incident_plus_station")
  val IdMinusStation: IncidentMasterId = IncidentMasterId("incident_minus_station")
  val IdCardStation: IncidentMasterId = IncidentMasterId("incident_card_station")
  val IdCardShop: IncidentMasterId = IncidentMasterId("incident_card_shop")
  val IdSuriNoGinji: IncidentMasterId = IncidentMasterId("incident_suri_no_ginji")

final case class PlayerResult(
    memberId: MemberId,
    playOrder: Int,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCounts,
)

final case class MatchRecord(
    id: MatchId,
    heldEventId: HeldEventId,
    matchNoInEvent: Int,
    gameTitleId: GameTitleId,
    layoutFamily: String,
    seasonMasterId: SeasonMasterId,
    ownerMemberId: MemberId,
    mapMasterId: MapMasterId,
    playedAt: Instant,
    totalAssetsDraftId: Option[OcrDraftId],
    revenueDraftId: Option[OcrDraftId],
    incidentLogDraftId: Option[OcrDraftId],
    players: List[PlayerResult],
    createdByMemberId: MemberId,
    createdAt: Instant,
)
