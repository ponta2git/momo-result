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
   * Pairs each count with its [[IncidentKind]] in the canonical order. The repository layer is
   * responsible for translating each kind to the corresponding `incident_masters.id`.
   */
  def entriesByKind: List[(IncidentKind, Int)] = List(
    IncidentKind.Destination -> destination,
    IncidentKind.PlusStation -> plusStation,
    IncidentKind.MinusStation -> minusStation,
    IncidentKind.CardStation -> cardStation,
    IncidentKind.CardShop -> cardShop,
    IncidentKind.SuriNoGinji -> suriNoGinji,
  )

object IncidentCounts:
  /** Builds an `IncidentCounts` from a kind-keyed map, defaulting missing kinds to 0. */
  def fromKindMap(values: Map[IncidentKind, Int]): IncidentCounts = IncidentCounts(
    destination = values.getOrElse(IncidentKind.Destination, 0),
    plusStation = values.getOrElse(IncidentKind.PlusStation, 0),
    minusStation = values.getOrElse(IncidentKind.MinusStation, 0),
    cardStation = values.getOrElse(IncidentKind.CardStation, 0),
    cardShop = values.getOrElse(IncidentKind.CardShop, 0),
    suriNoGinji = values.getOrElse(IncidentKind.SuriNoGinji, 0),
  )

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
    players: FourPlayers,
    createdByAccountId: AccountId,
    createdByMemberId: Option[MemberId],
    createdAt: Instant,
)

object MatchRecord:
  def apply(
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
      players: FourPlayers,
      createdByMemberId: MemberId,
      createdAt: Instant,
  ): MatchRecord = MatchRecord(
    id = id,
    heldEventId = heldEventId,
    matchNoInEvent = matchNoInEvent,
    gameTitleId = gameTitleId,
    layoutFamily = layoutFamily,
    seasonMasterId = seasonMasterId,
    ownerMemberId = ownerMemberId,
    mapMasterId = mapMasterId,
    playedAt = playedAt,
    totalAssetsDraftId = totalAssetsDraftId,
    revenueDraftId = revenueDraftId,
    incidentLogDraftId = incidentLogDraftId,
    players = players,
    createdByAccountId = AccountId(createdByMemberId.value),
    createdByMemberId = Some(createdByMemberId),
    createdAt = createdAt,
  )
