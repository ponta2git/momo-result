package momo.api.adapters.postgres

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
  final case class LoadedChunk(request: SeriesAnalysisChunkRequest, material: ChunkMaterial)

  enum ChunkMaterial:
    case Stored(chunk: SeriesAnalysisStoredChunk, sourceMatchRevision: Option[Long])
    case Excluded(
        artifact: SeriesAnalysisArtifactRef,
        matchId: MatchId,
        reason: SeriesAnalysisMatchContextExclusion,
    )

  final case class DisplayMetadata(memberNames: Map[String, String], scopeName: Option[String])

  private final case class MatchIdentityRow(
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      mapMasterId: MapMasterId,
      analysisRevision: Long,
  )

  private final case class MemberDisplayNameRow(id: String, displayName: String)

  /**
   * Each resource uses one SELECT for its identity, readable pointers and bounded payload. The
   * statement snapshot protects that classification against publication and cleanup without a
   * longer repeatable-read transaction or separate existence probes.
   */
  def load(
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[Either[AppError, LoadedChunk]] = localStatementTimeout(config) *>
    (request.kind match
      case SeriesAnalysisChunkKind.MatchContext => matchContextCio(request, config)
      case _ => regularChunkCio(request, config))

  def displayMetadata(
      artifact: SeriesAnalysisArtifactRef,
      scope: SeriesAnalysisScope,
      memberIds: List[String],
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[DisplayMetadata] =
    val ids = memberIds.toArray
    val scopeName = PostgresSeriesAnalysisScopeOps.displayName(artifact.gameTitleId, scope)
    val query = fr"SELECT m.id, m.display_name, scope.display_name FROM (SELECT" ++ scopeName ++
      fr"""AS display_name) scope
        LEFT JOIN members m ON m.id = ANY($ids)
      """
    localStatementTimeout(config) *>
      query.query[(Option[MemberDisplayNameRow], Option[String])]
        .nel.map(rows =>
          DisplayMetadata(
            rows.toList.flatMap(_._1).map(row => row.id -> row.displayName).toMap,
            rows.head._2,
          )
        )

  private def localStatementTimeout(config: SeriesAnalysisReadConfig): ConnectionIO[Unit] =
    val value = s"${config.readTimeout.toMillis}ms"
    sql"SELECT set_config('statement_timeout', $value, true)".query[String].unique.void

  private def regularChunkCio(
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[Either[AppError, LoadedChunk]] =
    val exists = PostgresSeriesAnalysisScopeOps.exists(request.gameTitleId, request.scope)
    val query = fr"SELECT" ++ exists ++ fr"," ++ storedColumns(config) ++
      readableArtifact(request) ++ chunkJoin(request)
    query.query[(Boolean, Option[SeriesAnalysisStoredChunk])].unique.map {
      case (false, _) => AppError.AnalysisScopeNotFound().asLeft
      case (_, None) => AppError.AnalysisArtifactExpired().asLeft
      case (_, Some(row)) => LoadedChunk(request, ChunkMaterial.Stored(row, None)).asRight
    }

  /**
   * Oversized or inconsistent rows keep their metadata but return an empty byte array. Decoding
   * rejects them, and the JDBC driver never allocates a payload larger than the admitted bound.
   */
  private def storedColumns(config: SeriesAnalysisReadConfig): Fragment = fr"""
    a.id, a.game_title_id, a.input_revision, a.algorithm_version,
    a.artifact_schema_version, a.validation_contract_id, a.published_at,
    c.scope_kind,
    CASE WHEN c.encoded_bytes BETWEEN 2 AND ${config.maxEncodedBytes}
          AND c.decoded_bytes = c.encoded_bytes AND c.decoded_bytes <= ${config.maxDecodedBytes}
          AND c.item_count BETWEEN 0 AND ${config.maxItemCount}
          AND c.nesting_depth BETWEEN 1 AND ${config.maxNestingDepth}
         THEN c.payload ELSE ''::bytea END,
    c.encoded_bytes, c.decoded_bytes, c.item_count, c.nesting_depth, c.checksum
  """

  private def readableArtifact(request: SeriesAnalysisChunkRequest): Fragment = fr"""
    FROM (VALUES (${request.gameTitleId})) requested(game_title_id)
    LEFT JOIN series_analysis_title_states s ON s.game_title_id = requested.game_title_id
    LEFT JOIN series_analysis_artifacts a
      ON a.game_title_id = s.game_title_id
     AND a.id = ${request.artifactId}
     AND a.status = 'published'
     AND a.artifact_schema_version = ${SeriesAnalysisArtifactSupport.ArtifactSchemaVersion}
     AND a.validation_contract_id = ${SeriesAnalysisArtifactSupport.ValidationContractId}
     AND a.id IN (s.current_artifact_id, s.previous_artifact_id)
  """

  private def chunkJoin(request: SeriesAnalysisChunkRequest): Fragment = request.kind match
    case SeriesAnalysisChunkKind.Aggregate => fr"""
        LEFT JOIN series_analysis_scope_aggregate_artifacts c
          ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
      """
    case SeriesAnalysisChunkKind.Review => fr"""
        LEFT JOIN series_analysis_scope_review_artifacts c
          ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
      """
    case SeriesAnalysisChunkKind.Drilldown => fr"""
        LEFT JOIN series_analysis_drilldown_artifacts c
          ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
         AND c.member_id = ${request.memberId.map(_.value)}
         AND c.metric_id = ${request.metric.map(_.id)}
      """
    case SeriesAnalysisChunkKind.MatchContext => fr"""
        LEFT JOIN series_analysis_match_context_artifacts c
          ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
         AND c.match_id = ${request.matchId.map(_.value)}
      """

  private def matchContextCio(
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[Either[AppError, LoadedChunk]] = request.matchId match
    case None => AppError.ValidationFailed("matchId is required.").asLeft.pure[ConnectionIO]
    case Some(matchId) =>
      val query =
        fr"""
        SELECT m.game_title_id, m.season_master_id, m.map_master_id, m.analysis_revision,
      """ ++ storedColumns(config) ++ fr", c.source_match_revision" ++
          readableArtifact(request) ++ chunkJoin(request) ++
          fr"LEFT JOIN matches m ON m.id = $matchId"
      query.query[(Option[MatchIdentityRow], Option[SeriesAnalysisStoredChunk], Option[Long])]
        .unique.map {
          case (None, _, _) => AppError.NotFound("match", matchId.value).asLeft
          case (_, None, _) => AppError.AnalysisArtifactExpired().asLeft
          case (Some(current), Some(row), sourceRevision) =>
            val exclusion =
              if current.gameTitleId != request.gameTitleId then
                Some(SeriesAnalysisMatchContextExclusion.MatchChangedSinceArtifact)
              else if !PostgresSeriesAnalysisScopeOps.contains(
                  request.scope,
                  current.seasonMasterId,
                  current.mapMasterId,
                )
              then Some(SeriesAnalysisMatchContextExclusion.NotInScope)
              else
                sourceRevision match
                  case None => Some(SeriesAnalysisMatchContextExclusion.NotInArtifact)
                  case Some(value) if value != current.analysisRevision =>
                    Some(SeriesAnalysisMatchContextExclusion.MatchChangedSinceArtifact)
                  case Some(_) => None
            val material = exclusion.fold[ChunkMaterial](ChunkMaterial.Stored(row, sourceRevision))(
              reason => ChunkMaterial.Excluded(row.artifact, matchId, reason)
            )
            LoadedChunk(request, material).asRight
        }

end PostgresSeriesAnalysisChunkOps
