package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.*
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisScopeStatusOps:
  private final case class ScopeRow(
      artifactId: Option[String],
      seasonName: Option[String],
      mapName: Option[String],
      currentHasMatches: Boolean,
      publishedHasMatches: Option[Boolean],
  )

  def read(request: SeriesAnalysisScopeStatusRequest)
      : ConnectionIO[Either[AppError, SeriesAnalysisScopeStatus]] =
    val season = request.scope.seasonMasterId
    val map = request.scope.mapMasterId
    sql"""
      SELECT a.id, sm.name, mm.name,
        EXISTS(SELECT 1 FROM matches m WHERE m.game_title_id = gt.id
          AND ($season::text IS NULL OR m.season_master_id = $season)
          AND ($map::text IS NULL OR m.map_master_id = $map)),
        CASE WHEN a.id IS NULL THEN NULL ELSE
          ${request.scope.key} = ANY(a.scope_keys) AND a.match_context_chunk_count > 0 END
      FROM game_titles gt
      LEFT JOIN series_analysis_title_states s ON s.game_title_id = gt.id
      LEFT JOIN series_analysis_artifacts a ON a.game_title_id = gt.id
        AND a.id = ${request.artifactId} AND a.status = 'published'
        AND a.id IN (s.current_artifact_id, s.previous_artifact_id)
        AND a.artifact_schema_version = ${SeriesAnalysisArtifactContract.ArtifactSchemaVersion}
        AND a.validation_contract_id = ${SeriesAnalysisArtifactContract.ValidationContractId}
      LEFT JOIN season_masters sm ON sm.game_title_id = gt.id AND sm.id = $season
      LEFT JOIN map_masters mm ON mm.game_title_id = gt.id AND mm.id = $map
      WHERE gt.id = ${request.gameTitleId}
    """.query[ScopeRow].option.map {
      case None => AppError.NotFound("game title", request.gameTitleId.value).asLeft
      case Some(row) if request.artifactId.nonEmpty && row.artifactId.isEmpty =>
        AppError.AnalysisArtifactExpired().asLeft
      case Some(row) =>
        val invalid = List(
          Option.when(season.nonEmpty && row.seasonName.isEmpty)("seasonMasterId"),
          Option.when(map.nonEmpty && row.mapName.isEmpty)("mapMasterId"),
        ).flatten
        val state =
          if invalid.nonEmpty then "invalid"
          else if row.publishedHasMatches.contains(true) then "available"
          else if row.currentHasMatches then "awaiting_analysis"
          else "empty"
        SeriesAnalysisScopeStatus(request.gameTitleId, row.artifactId, request.scope, state,
          row.seasonName, row.mapName, invalid, row.currentHasMatches, row.publishedHasMatches).asRight
    }
