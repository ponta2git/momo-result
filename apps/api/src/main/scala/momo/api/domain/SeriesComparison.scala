package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

enum SeriesComparisonScope derives CanEqual:
  case Overall(gameTitleId: GameTitleId)
  case Season(gameTitleId: GameTitleId, seasonMasterId: SeasonMasterId)
  case Map(gameTitleId: GameTitleId, mapMasterId: MapMasterId)
  case SeasonMap(gameTitleId: GameTitleId, seasonMasterId: SeasonMasterId, mapMasterId: MapMasterId)

  def selectedGameTitleId: GameTitleId = this match
    case Overall(id) => id
    case Season(id, _) => id
    case Map(id, _) => id
    case SeasonMap(id, _, _) => id

  def kindWire: String = this match
    case Overall(_) => "overall"
    case Season(_, _) => "season"
    case Map(_, _) => "map"
    case SeasonMap(_, _, _) => "season_map"

  def scopeIdValue: Option[String] = this match
    case Overall(_) => None
    case Season(_, id) => Some(id.value)
    case Map(_, id) => Some(id.value)
    case SeasonMap(_, seasonId, mapId) => Some(s"${seasonId.value}:${mapId.value}")

  def selectedSeasonMasterId: Option[SeasonMasterId] = this match
    case Season(_, id) => Some(id)
    case SeasonMap(_, id, _) => Some(id)
    case Overall(_) | Map(_, _) => None

  def selectedMapMasterId: Option[MapMasterId] = this match
    case Map(_, id) => Some(id)
    case SeasonMap(_, _, id) => Some(id)
    case Overall(_) | Season(_, _) => None

final case class SeriesComparisonResolvedScope(
    gameTitleId: GameTitleId,
    gameTitleName: String,
    layoutFamily: String,
    scopeKind: String,
    scopeId: Option[String],
    scopeName: String,
    seasonMasterId: Option[SeasonMasterId] = None,
    seasonName: Option[String] = None,
    mapMasterId: Option[MapMasterId] = None,
    mapName: Option[String] = None,
)

final case class SeriesComparisonOptionsData(
    latestConfirmedGameTitleId: Option[GameTitleId],
    series: List[SeriesComparisonSeriesOptionData],
)

final case class SeriesComparisonSeriesOptionData(
    gameTitleId: GameTitleId,
    name: String,
    layoutFamily: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
    latestConfirmedPlayedAt: Option[Instant],
    seasons: List[SeriesComparisonScopeOptionData],
    maps: List[SeriesComparisonScopeOptionData],
)

final case class SeriesComparisonScopeOptionData(
    id: String,
    name: String,
    displayOrder: Int,
    confirmedMatchCount: Int,
)

final case class SeriesComparisonIncidentCountsRow(
    destination: Int,
    plusStation: Int,
    minusStation: Int,
    cardStation: Int,
    cardShop: Int,
    suriNoGinji: Int,
)

final case class SeriesComparisonMatchPlayerRow(
    matchId: MatchId,
    playedAt: Instant,
    heldEventId: HeldEventId,
    matchNoInEvent: MatchNoInEvent,
    gameTitleId: GameTitleId,
    seasonMasterId: SeasonMasterId,
    mapMasterId: MapMasterId,
    memberId: MemberId,
    memberDisplayName: String,
    playOrder: PlayOrder,
    rank: Rank,
    totalAssetsManYen: ManYen,
    revenueManYen: ManYen,
    incidents: SeriesComparisonIncidentCountsRow,
)

object SeriesComparisonPlayerOrder:
  private val PreferredMemberValues = List(
    "member_eu" -> 0,
    "eu" -> 0,
    "member_ponta" -> 1,
    "ponta" -> 1,
    "member_akane_mami" -> 2,
    "akane" -> 2,
    "akane-mami" -> 2,
    "member_otaka" -> 3,
    "otaka" -> 3,
  ).toMap

  def rowSortKey(row: SeriesComparisonMatchPlayerRow): (Int, Int, String, String) =
    val preferredOrder = PreferredMemberValues.getOrElse(row.memberId.value, Int.MaxValue)
    (
      preferredOrder,
      if preferredOrder == Int.MaxValue then row.playOrder.value else 0,
      row.memberDisplayName,
      row.memberId.value,
    )
