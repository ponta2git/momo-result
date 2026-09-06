package momo.api.adapters.postgres

import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.SeriesAnalysisScope
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}

private[postgres] object PostgresSeriesAnalysisScopeOps:
  def exists(
      gameTitleId: GameTitleId,
      scope: SeriesAnalysisScope,
  ): Fragment = scope match
    case SeriesAnalysisScope.Overall =>
      fr"EXISTS(SELECT 1 FROM game_titles WHERE id = $gameTitleId)"
    case SeriesAnalysisScope.Season(seasonId) => fr"""
        EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = $gameTitleId
            AND season_master_id = $seasonId
        )
      """
    case SeriesAnalysisScope.Map(mapId) => fr"""
        EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = $gameTitleId
            AND map_master_id = $mapId
        )
      """
    case SeriesAnalysisScope.SeasonMap(seasonId, mapId) => fr"""
        EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = $gameTitleId
            AND season_master_id = $seasonId
            AND map_master_id = $mapId
        )
      """

  def displayName(
      gameTitleId: GameTitleId,
      scope: SeriesAnalysisScope,
  ): Fragment = scope match
    case SeriesAnalysisScope.Overall => fr"'総合'::text"
    case SeriesAnalysisScope.Season(seasonId) => fr"""
        (SELECT name FROM season_masters
         WHERE game_title_id = $gameTitleId AND id = $seasonId)
      """
    case SeriesAnalysisScope.Map(mapId) => fr"""
        (SELECT name FROM map_masters
         WHERE game_title_id = $gameTitleId AND id = $mapId)
      """
    case SeriesAnalysisScope.SeasonMap(seasonId, mapId) => fr"""
        (SELECT s.name || ' / ' || m.name
        FROM season_masters s
        JOIN map_masters m ON m.game_title_id = s.game_title_id
        WHERE s.game_title_id = $gameTitleId
          AND s.id = $seasonId
          AND m.id = $mapId)
      """

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
