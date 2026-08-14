package momo.api.adapters.postgres

import cats.data.NonEmptyList
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MapMasterId, MatchId, SeasonMasterId}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisChunkOps:
  final case class LoadedChunk(
      request: SeriesAnalysisChunkRequest,
      material: ChunkMaterial,
  )

  enum ChunkMaterial:
    case Stored(chunk: SeriesAnalysisStoredChunk, sourceMatchRevision: Option[Long])
    case Excluded(
        artifact: SeriesAnalysisArtifactRef,
        matchId: MatchId,
        reason: SeriesAnalysisMatchContextExclusion,
    )

  final case class DisplayMetadata(
      memberNames: Map[String, String],
      scopeName: Option[String],
  )

  private final case class MatchIdentityRow(
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      mapMasterId: MapMasterId,
      analysisRevision: Long,
  )

  private final case class MatchContextChunkRow(
      chunk: SeriesAnalysisStoredChunk,
      sourceMatchRevision: Long,
  )

  private final case class MemberDisplayNameRow(id: String, displayName: String)

  def load(
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[Either[AppError, LoadedChunk]] = beginArtifactSnapshot(config) *>
    (request.kind match
      case SeriesAnalysisChunkKind.MatchContext => matchContextCio(request)
      case _ => regularChunkCio(request))

  def displayMetadata(
      chunk: SeriesAnalysisChunk,
      memberIds: List[String],
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[DisplayMetadata] = localStatementTimeout(config) *>
    (for
      names <- memberIds match
        case Nil => Map.empty[String, String].pure[ConnectionIO]
        case head :: tail =>
          val ids = NonEmptyList(head, tail)
          (fr"SELECT id, display_name FROM members WHERE " ++ Fragments.in(fr"id", ids))
            .query[MemberDisplayNameRow].to[List].map(_.map(row => row.id -> row.displayName).toMap)
      scopeName <- PostgresSeriesAnalysisScopeOps
        .displayName(chunk.artifact.gameTitleId, chunk.scope)
    yield DisplayMetadata(names, scopeName))

  private def localStatementTimeout(config: SeriesAnalysisReadConfig): ConnectionIO[Unit] =
    val value = s"${config.readTimeout.toMillis}ms"
    sql"SELECT set_config('statement_timeout', $value, true)".query[String].unique.void

  /** Keeps match identity, readable artifact pointers and stored chunk classification coherent. */
  private def beginArtifactSnapshot(config: SeriesAnalysisReadConfig): ConnectionIO[Unit] =
    sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY".update.run.void *>
      localStatementTimeout(config)

  private def regularChunkCio(
      request: SeriesAnalysisChunkRequest
  ): ConnectionIO[Either[AppError, LoadedChunk]] =
    for
      scopeExists <- PostgresSeriesAnalysisScopeOps.exists(request.gameTitleId, request.scope)
      row <- selectChunk(request)
      loaded = if !scopeExists then AppError.AnalysisScopeNotFound().asLeft
      else
        row match
          case None => AppError.AnalysisArtifactExpired().asLeft
          case Some(value) => LoadedChunk(request, ChunkMaterial.Stored(value, None)).asRight
    yield loaded

  private def selectChunk(
      request: SeriesAnalysisChunkRequest
  ): ConnectionIO[Option[SeriesAnalysisStoredChunk]] =
    val base = fr"""
      SELECT
        a.id,
        a.game_title_id,
        a.input_revision,
        a.algorithm_version,
        a.artifact_schema_version,
        a.published_at,
        c.scope_kind,
        c.payload,
        c.encoded_bytes,
        c.decoded_bytes,
        c.item_count,
        c.nesting_depth,
        c.checksum
      FROM series_analysis_title_states s
      JOIN series_analysis_artifacts a
        ON a.game_title_id = s.game_title_id
       AND a.id = ${request.artifactId}
       AND a.status = 'published'
       AND a.id IN (s.current_artifact_id, s.previous_artifact_id)
    """
    val query = request.kind match
      case SeriesAnalysisChunkKind.Aggregate => base ++ fr"""
          LEFT JOIN series_analysis_scope_aggregate_artifacts c
            ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
          WHERE s.game_title_id = ${request.gameTitleId}
        """
      case SeriesAnalysisChunkKind.Review => base ++ fr"""
          LEFT JOIN series_analysis_scope_review_artifacts c
            ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
          WHERE s.game_title_id = ${request.gameTitleId}
        """
      case SeriesAnalysisChunkKind.Drilldown => base ++ fr"""
          LEFT JOIN series_analysis_drilldown_artifacts c
            ON c.artifact_id = a.id
           AND c.scope_key = ${request.scope.key}
           AND c.member_id = ${request.memberId.map(_.value)}
           AND c.metric_id = ${request.metric.map(_.id)}
          WHERE s.game_title_id = ${request.gameTitleId}
        """
      case SeriesAnalysisChunkKind.MatchContext => Fragment.empty
    query.query[SeriesAnalysisStoredChunk].option

  private def matchContextCio(
      request: SeriesAnalysisChunkRequest
  ): ConnectionIO[Either[AppError, LoadedChunk]] = request.matchId match
    case None => AppError.ValidationFailed("matchId is required.").asLeft.pure[ConnectionIO]
    case Some(matchId) =>
      for
        current <- sql"""
          SELECT game_title_id, season_master_id, map_master_id, analysis_revision
          FROM matches
          WHERE id = $matchId
        """.query[MatchIdentityRow].option
        artifact <- selectReadableArtifact(request.gameTitleId, request.artifactId)
        loaded <- (current, artifact) match
          case (None, _) => AppError.NotFound("match", matchId.value).asLeft[LoadedChunk]
              .pure[ConnectionIO]
          case (_, None) => AppError.AnalysisArtifactExpired().asLeft[LoadedChunk]
              .pure[ConnectionIO]
          case (Some(identity), Some(artifactRef))
              if identity.gameTitleId != request.gameTitleId =>
            LoadedChunk(
              request,
              ChunkMaterial.Excluded(
                artifactRef,
                matchId,
                SeriesAnalysisMatchContextExclusion.MatchChangedSinceArtifact,
              ),
            ).asRight[AppError].pure[ConnectionIO]
          case (Some(identity), Some(artifactRef))
              if !PostgresSeriesAnalysisScopeOps.contains(
                request.scope,
                identity.seasonMasterId,
                identity.mapMasterId,
              ) =>
            LoadedChunk(
              request,
              ChunkMaterial.Excluded(
                artifactRef,
                matchId,
                SeriesAnalysisMatchContextExclusion.NotInScope,
              ),
            )
              .asRight[AppError]
              .pure[ConnectionIO]
          case (Some(identity), Some(artifactRef)) =>
            selectMatchContextChunk(request, matchId).map {
              case None => LoadedChunk(
                  request,
                  ChunkMaterial.Excluded(
                    artifactRef,
                    matchId,
                    SeriesAnalysisMatchContextExclusion.NotInArtifact,
                  ),
                ).asRight
              case Some(row) if row.sourceMatchRevision != identity.analysisRevision =>
                LoadedChunk(
                  request,
                  ChunkMaterial.Excluded(
                    artifactRef,
                    matchId,
                    SeriesAnalysisMatchContextExclusion.MatchChangedSinceArtifact,
                  ),
                ).asRight
              case Some(row) =>
                LoadedChunk(
                  request,
                  ChunkMaterial.Stored(row.chunk, Some(row.sourceMatchRevision)),
                ).asRight
            }
      yield loaded

  private def selectReadableArtifact(
      gameTitleId: GameTitleId,
      artifactId: String,
  ): ConnectionIO[Option[SeriesAnalysisArtifactRef]] = sql"""
    SELECT
      a.id,
      a.game_title_id,
      a.input_revision,
      a.algorithm_version,
      a.artifact_schema_version,
      a.published_at
    FROM series_analysis_title_states s
    JOIN series_analysis_artifacts a
      ON a.id = $artifactId
     AND a.game_title_id = s.game_title_id
     AND a.status = 'published'
     AND a.id IN (s.current_artifact_id, s.previous_artifact_id)
    WHERE s.game_title_id = $gameTitleId
  """.query[SeriesAnalysisArtifactRef].option

  private def selectMatchContextChunk(
      request: SeriesAnalysisChunkRequest,
      matchId: MatchId,
  ): ConnectionIO[Option[MatchContextChunkRow]] = sql"""
    SELECT
      a.id,
      a.game_title_id,
      a.input_revision,
      a.algorithm_version,
      a.artifact_schema_version,
      a.published_at,
      c.scope_kind,
      c.payload,
      c.encoded_bytes,
      c.decoded_bytes,
      c.item_count,
      c.nesting_depth,
      c.checksum,
      c.source_match_revision
    FROM series_analysis_title_states s
    JOIN series_analysis_artifacts a
      ON a.id = ${request.artifactId}
     AND a.game_title_id = s.game_title_id
     AND a.status = 'published'
     AND a.id IN (s.current_artifact_id, s.previous_artifact_id)
    JOIN series_analysis_match_context_artifacts c
      ON c.artifact_id = a.id
     AND c.scope_key = ${request.scope.key}
     AND c.match_id = $matchId
    WHERE s.game_title_id = ${request.gameTitleId}
  """.query[MatchContextChunkRow].option

end PostgresSeriesAnalysisChunkOps
