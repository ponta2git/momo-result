package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

enum SeriesComparisonScope derives CanEqual:
  case Overall(gameTitleId: GameTitleId)
  case Season(gameTitleId: GameTitleId, seasonMasterId: SeasonMasterId)
  case Map(gameTitleId: GameTitleId, mapMasterId: MapMasterId)

  def selectedGameTitleId: GameTitleId = this match
    case Overall(id) => id
    case Season(id, _) => id
    case Map(id, _) => id

  def kindWire: String = this match
    case Overall(_) => "overall"
    case Season(_, _) => "season"
    case Map(_, _) => "map"

  def scopeIdValue: Option[String] = this match
    case Overall(_) => None
    case Season(_, id) => Some(id.value)
    case Map(_, id) => Some(id.value)

final case class SeriesComparisonResolvedScope(
    gameTitleId: GameTitleId,
    gameTitleName: String,
    layoutFamily: String,
    scopeKind: String,
    scopeId: Option[String],
    scopeName: String,
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
