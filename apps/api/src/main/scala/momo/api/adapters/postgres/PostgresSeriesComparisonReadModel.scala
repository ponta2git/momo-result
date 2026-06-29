package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{
  MatchNoInEvent,
  PlayOrder,
  Rank,
  SeriesComparisonIncidentCountsRow,
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonOptionsData,
  SeriesComparisonResolvedScope,
  SeriesComparisonScope,
  SeriesComparisonScopeOptionData,
  SeriesComparisonSeriesOptionData
}
import momo.api.repositories.{SeriesComparisonReadAlg, SeriesComparisonReadModel}

object PostgresSeriesComparison:
  private final case class SeriesRow(
      gameTitleId: GameTitleId,
      name: String,
      layoutFamily: String,
      displayOrder: Int,
      confirmedMatchCount: Int,
      latestConfirmedPlayedAt: Option[Instant],
  )

  private final case class ScopeOptionRow(
      gameTitleId: GameTitleId,
      id: String,
      name: String,
      displayOrder: Int,
      confirmedMatchCount: Int,
  )

  private final case class PlayerRow(
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

  private final case class OverallScopeRow(
      gameTitleId: GameTitleId,
      gameTitleName: String,
      layoutFamily: String,
  )

  private final case class NamedScopeRow(
      gameTitleName: String,
      layoutFamily: String,
      scopeName: String,
  )

  private final case class SeasonMapScopeRow(
      gameTitleName: String,
      layoutFamily: String,
      seasonName: String,
      mapName: String,
  )

  val alg: SeriesComparisonReadAlg[ConnectionIO] = new SeriesComparisonReadAlg[ConnectionIO]:
    override def options: ConnectionIO[SeriesComparisonOptionsData] =
      val seriesQuery = sql"""
          SELECT
            gt.id,
            gt.name,
            gt.layout_family,
            gt.display_order,
            COUNT(m.id)::int AS confirmed_match_count,
            MAX(m.played_at) AS latest_confirmed_played_at
          FROM game_titles gt
          LEFT JOIN matches m ON m.game_title_id = gt.id
          GROUP BY gt.id, gt.name, gt.layout_family, gt.display_order
          ORDER BY gt.display_order, gt.name, gt.id
        """.query[SeriesRow].to[List]
      val seasonQuery = sql"""
          SELECT
            s.game_title_id,
            s.id,
            s.name,
            s.display_order,
            COUNT(m.id)::int AS confirmed_match_count
          FROM season_masters s
          LEFT JOIN matches m
            ON m.season_master_id = s.id
           AND m.game_title_id = s.game_title_id
          GROUP BY s.game_title_id, s.id, s.name, s.display_order
          ORDER BY s.game_title_id, s.display_order, s.name, s.id
        """.query[ScopeOptionRow].to[List]
      val mapQuery = sql"""
          SELECT
            mm.game_title_id,
            mm.id,
            mm.name,
            mm.display_order,
            COUNT(m.id)::int AS confirmed_match_count
          FROM map_masters mm
          LEFT JOIN matches m
            ON m.map_master_id = mm.id
           AND m.game_title_id = mm.game_title_id
          GROUP BY mm.game_title_id, mm.id, mm.name, mm.display_order
          ORDER BY mm.game_title_id, mm.display_order, mm.name, mm.id
        """.query[ScopeOptionRow].to[List]
      for
        seriesRows <- seriesQuery
        seasonRows <- seasonQuery
        mapRows <- mapQuery
      yield
        val seasonsByTitle = scopeOptionsByTitle(seasonRows)
        val mapsByTitle = scopeOptionsByTitle(mapRows)
        val latest = seriesRows.filter(_.confirmedMatchCount > 0).sortBy(row =>
          (
            -row.latestConfirmedPlayedAt.map(_.toEpochMilli).getOrElse(Long.MinValue),
            row.displayOrder,
            row.name,
            row.gameTitleId.value,
          )
        ).headOption.map(_.gameTitleId)
        SeriesComparisonOptionsData(
          latestConfirmedGameTitleId = latest,
          series = seriesRows.map { row =>
            SeriesComparisonSeriesOptionData(
              gameTitleId = row.gameTitleId,
              name = row.name,
              layoutFamily = row.layoutFamily,
              displayOrder = row.displayOrder,
              confirmedMatchCount = row.confirmedMatchCount,
              latestConfirmedPlayedAt = row.latestConfirmedPlayedAt,
              seasons = seasonsByTitle.getOrElse(row.gameTitleId, Nil),
              maps = mapsByTitle.getOrElse(row.gameTitleId, Nil),
            )
          },
        )

    override def resolveScope(
        scope: SeriesComparisonScope
    ): ConnectionIO[Option[SeriesComparisonResolvedScope]] = scope match
      case SeriesComparisonScope.Overall(gameTitleId) => sql"""
          SELECT id, name, layout_family
          FROM game_titles
          WHERE id = $gameTitleId
        """.query[OverallScopeRow].option.map(_.map(row =>
          SeriesComparisonResolvedScope(
            gameTitleId = row.gameTitleId,
            gameTitleName = row.gameTitleName,
            layoutFamily = row.layoutFamily,
            scopeKind = "overall",
            scopeId = None,
            scopeName = "総合",
          )
        ))
      case SeriesComparisonScope.Season(gameTitleId, seasonMasterId) => sql"""
          SELECT gt.name, gt.layout_family, s.name
          FROM season_masters s
          JOIN game_titles gt ON gt.id = s.game_title_id
          WHERE s.id = $seasonMasterId AND s.game_title_id = $gameTitleId
        """.query[NamedScopeRow].option.map(_.map { row =>
          SeriesComparisonResolvedScope(
            gameTitleId = gameTitleId,
            gameTitleName = row.gameTitleName,
            layoutFamily = row.layoutFamily,
            scopeKind = "season",
            scopeId = Some(seasonMasterId.value),
            scopeName = row.scopeName,
            seasonMasterId = Some(seasonMasterId),
            seasonName = Some(row.scopeName),
          )
        })
      case SeriesComparisonScope.Map(gameTitleId, mapMasterId) => sql"""
          SELECT gt.name, gt.layout_family, mm.name
          FROM map_masters mm
          JOIN game_titles gt ON gt.id = mm.game_title_id
          WHERE mm.id = $mapMasterId AND mm.game_title_id = $gameTitleId
        """.query[NamedScopeRow].option.map(_.map { row =>
          SeriesComparisonResolvedScope(
            gameTitleId = gameTitleId,
            gameTitleName = row.gameTitleName,
            layoutFamily = row.layoutFamily,
            scopeKind = "map",
            scopeId = Some(mapMasterId.value),
            scopeName = row.scopeName,
            mapMasterId = Some(mapMasterId),
            mapName = Some(row.scopeName),
          )
        })
      case SeriesComparisonScope.SeasonMap(gameTitleId, seasonMasterId, mapMasterId) => sql"""
          SELECT gt.name, gt.layout_family, s.name, mm.name
          FROM game_titles gt
          JOIN season_masters s ON s.game_title_id = gt.id
          JOIN map_masters mm ON mm.game_title_id = gt.id
          WHERE gt.id = $gameTitleId
            AND s.id = $seasonMasterId
            AND mm.id = $mapMasterId
        """.query[SeasonMapScopeRow].option
          .map(_.map { row =>
            SeriesComparisonResolvedScope(
              gameTitleId = gameTitleId,
              gameTitleName = row.gameTitleName,
              layoutFamily = row.layoutFamily,
              scopeKind = "season_map",
              scopeId = None,
              scopeName = s"${row.seasonName} / ${row.mapName}",
              seasonMasterId = Some(seasonMasterId),
              seasonName = Some(row.seasonName),
              mapMasterId = Some(mapMasterId),
              mapName = Some(row.mapName),
            )
          })

    override def loadRows(
        scope: SeriesComparisonResolvedScope
    ): ConnectionIO[List[SeriesComparisonMatchPlayerRow]] =
      val destinationId = IncidentKindMapping.masterId(momo.api.domain.IncidentKind.Destination)
      val plusId = IncidentKindMapping.masterId(momo.api.domain.IncidentKind.PlusStation)
      val minusId = IncidentKindMapping.masterId(momo.api.domain.IncidentKind.MinusStation)
      val cardStationId = IncidentKindMapping.masterId(momo.api.domain.IncidentKind.CardStation)
      val cardShopId = IncidentKindMapping.masterId(momo.api.domain.IncidentKind.CardShop)
      val ginjiId = IncidentKindMapping.masterId(momo.api.domain.IncidentKind.SuriNoGinji)
      val scopedCondition = List(
        scope.seasonMasterId.map(id => fr"AND m.season_master_id = $id"),
        scope.mapMasterId.map(id => fr"AND m.map_master_id = $id"),
      ).flatten.foldLeft(Fragment.empty)(_ ++ _)
      val query =
        fr"""
          SELECT
            m.id,
            m.played_at,
            m.held_event_id,
            m.match_no_in_event,
            m.game_title_id,
            m.season_master_id,
            m.map_master_id,
            mp.member_id,
            mem.display_name,
            mp.play_order,
            mp.rank,
            mp.total_assets_man_yen,
            mp.revenue_man_yen,
            COALESCE(SUM(CASE WHEN mi.incident_master_id = $destinationId THEN mi.count ELSE 0 END), 0)::int,
            COALESCE(SUM(CASE WHEN mi.incident_master_id = $plusId THEN mi.count ELSE 0 END), 0)::int,
            COALESCE(SUM(CASE WHEN mi.incident_master_id = $minusId THEN mi.count ELSE 0 END), 0)::int,
            COALESCE(SUM(CASE WHEN mi.incident_master_id = $cardStationId THEN mi.count ELSE 0 END), 0)::int,
            COALESCE(SUM(CASE WHEN mi.incident_master_id = $cardShopId THEN mi.count ELSE 0 END), 0)::int,
            COALESCE(SUM(CASE WHEN mi.incident_master_id = $ginjiId THEN mi.count ELSE 0 END), 0)::int
          FROM matches m
          JOIN match_players mp ON mp.match_id = m.id
          JOIN members mem ON mem.id = mp.member_id
          LEFT JOIN match_incidents mi
            ON mi.match_id = mp.match_id
           AND mi.member_id = mp.member_id
          WHERE m.game_title_id = ${scope.gameTitleId}
        """ ++ scopedCondition ++ fr"""
          GROUP BY
            m.id, m.played_at, m.held_event_id, m.match_no_in_event,
            m.game_title_id, m.season_master_id, m.map_master_id,
            mp.member_id, mem.display_name, mp.play_order, mp.rank,
            mp.total_assets_man_yen, mp.revenue_man_yen
          ORDER BY
            m.played_at ASC,
            m.held_event_id ASC,
            m.match_no_in_event ASC,
            m.id ASC,
            mp.play_order ASC
        """
      query.query[PlayerRow].to[List].map(_.map(domainRow))

  private def scopeOptionsByTitle(
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

  private def domainRow(row: PlayerRow): SeriesComparisonMatchPlayerRow =
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
end PostgresSeriesComparison

final class PostgresSeriesComparisonReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SeriesComparisonReadModel[F]:
  private val delegate: SeriesComparisonReadModel[F] = SeriesComparisonReadModel
    .fromAlg(PostgresSeriesComparison.alg, Database.transactK(transactor))

  export delegate.*
end PostgresSeriesComparisonReadModel
