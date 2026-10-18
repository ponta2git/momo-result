package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.domain.SeriesAnalysisScope
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}

private[postgres] object PostgresSeriesAnalysisScopeOps:
  def normalize(scope: SeriesAnalysisScope)(using
      identities: PostgresIdentities): ConnectionIO[SeriesAnalysisScope] = scope match
    case SeriesAnalysisScope.Overall => scope.pure[ConnectionIO]
    case SeriesAnalysisScope.Season(id) => identities.normalize(Entity.SeasonMasters, id.value)
        .map(value => SeriesAnalysisScope.Season(SeasonMasterId.unsafeFromString(value)))
    case SeriesAnalysisScope.Map(id) => identities.normalize(Entity.MapMasters, id.value)
        .map(value => SeriesAnalysisScope.Map(MapMasterId.unsafeFromString(value)))
    case SeriesAnalysisScope.SeasonMap(season, map) => (
        identities.normalize(Entity.SeasonMasters, season.value),
        identities.normalize(Entity.MapMasters, map.value)
      ).mapN((s, m) =>
        SeriesAnalysisScope.SeasonMap(
          SeasonMasterId.unsafeFromString(s),
          MapMasterId.unsafeFromString(m)
        )
      )

  /** Valid identities remain selectable even when their current combination has no matches. */
  def valid(gameTitleId: GameTitleId, scope: SeriesAnalysisScope)(using
      identities: PostgresIdentities): Fragment = scope match
    case SeriesAnalysisScope.Overall =>
      fr"EXISTS(SELECT 1 FROM game_titles WHERE id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)})"
    case SeriesAnalysisScope.Season(id) => fr"""
      EXISTS(SELECT 1 FROM season_masters WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          gameTitleId.value
        )} AND id = ${identities.lookup(Entity.SeasonMasters, id.value)})
    """
    case SeriesAnalysisScope.Map(id) => fr"""
      EXISTS(SELECT 1 FROM map_masters WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          gameTitleId.value
        )} AND id = ${identities.lookup(Entity.MapMasters, id.value)})
    """
    case SeriesAnalysisScope.SeasonMap(season, map) => fr"""
      EXISTS(SELECT 1 FROM season_masters WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          gameTitleId.value
        )} AND id = ${identities.lookup(Entity.SeasonMasters, season.value)})
      AND EXISTS(SELECT 1 FROM map_masters WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          gameTitleId.value
        )} AND id = ${identities.lookup(Entity.MapMasters, map.value)})
    """

  def exists(
      gameTitleId: GameTitleId,
      scope: SeriesAnalysisScope,
  )(using identities: PostgresIdentities): Fragment = scope match
    case SeriesAnalysisScope.Overall =>
      fr"EXISTS(SELECT 1 FROM game_titles WHERE id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)})"
    case SeriesAnalysisScope.Season(seasonId) => fr"""
        EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
            AND season_master_id = ${identities.lookup(Entity.SeasonMasters, seasonId.value)}
        )
      """
    case SeriesAnalysisScope.Map(mapId) => fr"""
        EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
            AND map_master_id = ${identities.lookup(Entity.MapMasters, mapId.value)}
        )
      """
    case SeriesAnalysisScope.SeasonMap(seasonId, mapId) => fr"""
        EXISTS(
          SELECT 1 FROM matches
          WHERE game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
            AND season_master_id = ${identities.lookup(Entity.SeasonMasters, seasonId.value)}
            AND map_master_id = ${identities.lookup(Entity.MapMasters, mapId.value)}
        )
      """

  def displayName(
      gameTitleId: GameTitleId,
      scope: SeriesAnalysisScope,
  )(using identities: PostgresIdentities): Fragment = scope match
    case SeriesAnalysisScope.Overall => fr"'総合'::text"
    case SeriesAnalysisScope.Season(seasonId) => fr"""
        (SELECT name FROM season_masters
         WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          gameTitleId.value
        )} AND id = ${identities.lookup(Entity.SeasonMasters, seasonId.value)})
      """
    case SeriesAnalysisScope.Map(mapId) => fr"""
        (SELECT name FROM map_masters
         WHERE game_title_id = ${identities.lookup(
          Entity.GameTitles,
          gameTitleId.value
        )} AND id = ${identities.lookup(Entity.MapMasters, mapId.value)})
      """
    case SeriesAnalysisScope.SeasonMap(seasonId, mapId) => fr"""
        (SELECT s.name || ' / ' || m.name
        FROM season_masters s
        JOIN map_masters m ON m.game_title_id = s.game_title_id
        WHERE s.game_title_id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
          AND s.id = ${identities.lookup(Entity.SeasonMasters, seasonId.value)}
          AND m.id = ${identities.lookup(Entity.MapMasters, mapId.value)})
      """

end PostgresSeriesAnalysisScopeOps
