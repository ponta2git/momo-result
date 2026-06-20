package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{
  GameTitle,
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
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{SeriesComparisonReadAlg, SeriesComparisonReadModel}

object PostgresSeriesComparison:
  private type SeriesRow = (GameTitleId, String, String, Int, Int, Option[Instant])
  private type ScopeOptionRow = (GameTitleId, String, String, Int, Int)
  private type PlayerRow = (
      MatchId,
      Instant,
      HeldEventId,
      MatchNoInEvent,
      GameTitleId,
      SeasonMasterId,
      MapMasterId,
      MemberId,
      String,
      PlayOrder,
      Rank,
      Int,
      Int,
      Int,
      Int,
      Int,
      Int,
      Int,
      Int,
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
        val latest = seriesRows.filter(_._5 > 0).sortBy(row =>
          (-row._6.map(_.toEpochMilli).getOrElse(Long.MinValue), row._4, row._2, row._1.value)
        ).headOption.map(_._1)
        SeriesComparisonOptionsData(
          latestConfirmedGameTitleId = latest,
          series = seriesRows.map { row =>
            SeriesComparisonSeriesOptionData(
              gameTitleId = row._1,
              name = row._2,
              layoutFamily = row._3,
              displayOrder = row._4,
              confirmedMatchCount = row._5,
              latestConfirmedPlayedAt = row._6,
              seasons = seasonsByTitle.getOrElse(row._1, Nil),
              maps = mapsByTitle.getOrElse(row._1, Nil),
            )
          },
        )

    override def resolveScope(
        scope: SeriesComparisonScope
    ): ConnectionIO[Option[SeriesComparisonResolvedScope]] = scope match
      case SeriesComparisonScope.Overall(gameTitleId) => sql"""
          SELECT id, name, layout_family, display_order, created_at
          FROM game_titles
          WHERE id = $gameTitleId
        """.query[GameTitle].option.map(_.map(gt =>
          SeriesComparisonResolvedScope(
            gameTitleId = gt.id,
            gameTitleName = gt.name,
            layoutFamily = gt.layoutFamily,
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
        """.query[(String, String, String)].option.map(_.map { case (gameTitleName, layout, name) =>
          SeriesComparisonResolvedScope(
            gameTitleId = gameTitleId,
            gameTitleName = gameTitleName,
            layoutFamily = layout,
            scopeKind = "season",
            scopeId = Some(seasonMasterId.value),
            scopeName = name,
            seasonMasterId = Some(seasonMasterId),
            seasonName = Some(name),
          )
        })
      case SeriesComparisonScope.Map(gameTitleId, mapMasterId) => sql"""
          SELECT gt.name, gt.layout_family, mm.name
          FROM map_masters mm
          JOIN game_titles gt ON gt.id = mm.game_title_id
          WHERE mm.id = $mapMasterId AND mm.game_title_id = $gameTitleId
        """.query[(String, String, String)].option.map(_.map { case (gameTitleName, layout, name) =>
          SeriesComparisonResolvedScope(
            gameTitleId = gameTitleId,
            gameTitleName = gameTitleName,
            layoutFamily = layout,
            scopeKind = "map",
            scopeId = Some(mapMasterId.value),
            scopeName = name,
            mapMasterId = Some(mapMasterId),
            mapName = Some(name),
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
        """.query[(String, String, String, String)].option
          .map(_.map { case (gameTitleName, layout, seasonName, mapName) =>
            SeriesComparisonResolvedScope(
              gameTitleId = gameTitleId,
              gameTitleName = gameTitleName,
              layoutFamily = layout,
              scopeKind = "season_map",
              scopeId = None,
              scopeName = s"$seasonName / $mapName",
              seasonMasterId = Some(seasonMasterId),
              seasonName = Some(seasonName),
              mapMasterId = Some(mapMasterId),
              mapName = Some(mapName),
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
  ): Map[GameTitleId, List[SeriesComparisonScopeOptionData]] = rows.groupBy(_._1).view
    .mapValues(_.map(row =>
      SeriesComparisonScopeOptionData(
        id = row._2,
        name = row._3,
        displayOrder = row._4,
        confirmedMatchCount = row._5,
      )
    )).toMap

  private def domainRow(row: PlayerRow): SeriesComparisonMatchPlayerRow =
    SeriesComparisonMatchPlayerRow(
      matchId = row._1,
      playedAt = row._2,
      heldEventId = row._3,
      matchNoInEvent = row._4,
      gameTitleId = row._5,
      seasonMasterId = row._6,
      mapMasterId = row._7,
      memberId = row._8,
      memberDisplayName = row._9,
      playOrder = row._10,
      rank = row._11,
      totalAssetsManYen = momo.api.domain.ManYen.fromInt(row._12),
      revenueManYen = momo.api.domain.ManYen.fromInt(row._13),
      incidents = SeriesComparisonIncidentCountsRow(
        destination = row._14,
        plusStation = row._15,
        minusStation = row._16,
        cardStation = row._17,
        cardShop = row._18,
        suriNoGinji = row._19,
      ),
    )
end PostgresSeriesComparison

final class PostgresSeriesComparisonReadModel[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SeriesComparisonReadModel[F]:
  private val delegate: SeriesComparisonReadModel[F] = SeriesComparisonReadModel
    .fromAlg(PostgresSeriesComparison.alg, Database.transactK(transactor))

  export delegate.*
end PostgresSeriesComparisonReadModel
