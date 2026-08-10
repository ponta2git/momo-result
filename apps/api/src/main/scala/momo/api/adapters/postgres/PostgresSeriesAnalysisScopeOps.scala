package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.SeriesAnalysisScope
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}

private[postgres] object PostgresSeriesAnalysisScopeOps:
  def exists(
      gameTitleId: GameTitleId,
      scope: SeriesAnalysisScope,
  ): ConnectionIO[Boolean] = scope match
    case SeriesAnalysisScope.Overall =>
      sql"SELECT EXISTS(SELECT 1 FROM game_titles WHERE id = $gameTitleId)"
        .query[Boolean].unique
    case SeriesAnalysisScope.Season(seasonId) => sql"""
        SELECT EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = $gameTitleId
            AND season_master_id = $seasonId
        )
      """.query[Boolean].unique
    case SeriesAnalysisScope.Map(mapId) => sql"""
        SELECT EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = $gameTitleId
            AND map_master_id = $mapId
        )
      """.query[Boolean].unique
    case SeriesAnalysisScope.SeasonMap(seasonId, mapId) => sql"""
        SELECT EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = $gameTitleId
            AND season_master_id = $seasonId
            AND map_master_id = $mapId
        )
      """.query[Boolean].unique

  def displayName(
      gameTitleId: GameTitleId,
      scope: SeriesAnalysisScope,
  ): ConnectionIO[Option[String]] = scope match
    case SeriesAnalysisScope.Overall => Option("総合").pure[ConnectionIO]
    case SeriesAnalysisScope.Season(seasonId) => sql"""
        SELECT name FROM season_masters
        WHERE game_title_id = $gameTitleId AND id = $seasonId
      """.query[String].option
    case SeriesAnalysisScope.Map(mapId) => sql"""
        SELECT name FROM map_masters
        WHERE game_title_id = $gameTitleId AND id = $mapId
      """.query[String].option
    case SeriesAnalysisScope.SeasonMap(seasonId, mapId) => sql"""
        SELECT s.name || ' / ' || m.name
        FROM season_masters s
        JOIN map_masters m ON m.game_title_id = s.game_title_id
        WHERE s.game_title_id = $gameTitleId
          AND s.id = $seasonId
          AND m.id = $mapId
      """.query[String].option

  def contains(
      scope: SeriesAnalysisScope,
      seasonMasterId: SeasonMasterId,
      mapMasterId: MapMasterId,
  ): Boolean = scope match
    case SeriesAnalysisScope.Overall => true
    case SeriesAnalysisScope.Season(id) => id == seasonMasterId
    case SeriesAnalysisScope.Map(id) => id == mapMasterId
    case SeriesAnalysisScope.SeasonMap(seasonId, mapId) =>
      seasonId == seasonMasterId && mapId == mapMasterId

end PostgresSeriesAnalysisScopeOps
