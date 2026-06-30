package momo.api.adapters.postgres

import java.time.Instant

import momo.api.domain.ids.*
import momo.api.domain.{
  MatchNoInEvent,
  PlayOrder,
  Rank,
  SeriesComparisonIncidentCountsRow,
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonScopeOptionData
}

private[postgres] trait PostgresSeriesComparisonRowSupport:
  protected final case class SeriesRow(
      gameTitleId: GameTitleId,
      name: String,
      layoutFamily: String,
      displayOrder: Int,
      confirmedMatchCount: Int,
      latestConfirmedPlayedAt: Option[Instant],
  )

  protected final case class ScopeOptionRow(
      gameTitleId: GameTitleId,
      id: String,
      name: String,
      displayOrder: Int,
      confirmedMatchCount: Int,
  )

  protected final case class PlayerRow(
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
      totalAssetsManYen: Int,
      revenueManYen: Int,
      destinationCount: Int,
      plusStationCount: Int,
      minusStationCount: Int,
      cardStationCount: Int,
      cardShopCount: Int,
      suriNoGinjiCount: Int,
  )

  protected final case class OverallScopeRow(
      gameTitleId: GameTitleId,
      gameTitleName: String,
      layoutFamily: String,
  )

  protected final case class NamedScopeRow(
      gameTitleName: String,
      layoutFamily: String,
      scopeName: String,
  )

  protected final case class SeasonMapScopeRow(
      gameTitleName: String,
      layoutFamily: String,
      seasonName: String,
      mapName: String,
  )

  protected final def scopeOptionsByTitle(
      rows: List[ScopeOptionRow]
  ): Map[GameTitleId, List[SeriesComparisonScopeOptionData]] = rows.groupBy(_.gameTitleId).view
    .mapValues(_.map(row =>
      SeriesComparisonScopeOptionData(
        id = row.id,
        name = row.name,
        displayOrder = row.displayOrder,
        confirmedMatchCount = row.confirmedMatchCount,
      )
    )).toMap

  protected final def domainRow(row: PlayerRow): SeriesComparisonMatchPlayerRow =
    SeriesComparisonMatchPlayerRow(
      matchId = row.matchId,
      playedAt = row.playedAt,
      heldEventId = row.heldEventId,
      matchNoInEvent = row.matchNoInEvent,
      gameTitleId = row.gameTitleId,
      seasonMasterId = row.seasonMasterId,
      mapMasterId = row.mapMasterId,
      memberId = row.memberId,
      memberDisplayName = row.memberDisplayName,
      playOrder = row.playOrder,
      rank = row.rank,
      totalAssetsManYen = momo.api.domain.ManYen.fromInt(row.totalAssetsManYen),
      revenueManYen = momo.api.domain.ManYen.fromInt(row.revenueManYen),
      incidents = SeriesComparisonIncidentCountsRow(
        destination = row.destinationCount,
        plusStation = row.plusStationCount,
        minusStation = row.minusStationCount,
        cardStation = row.cardStationCount,
        cardShop = row.cardShopCount,
        suriNoGinji = row.suriNoGinjiCount,
      ),
    )
