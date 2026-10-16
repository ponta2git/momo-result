package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MapMasterId, MatchId, MemberId, SeasonMasterId}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisChunkOps:
  final case class LoadedChunk(
      request: SeriesAnalysisChunkRequest,
      material: ChunkMaterial,
      displayMetadata: Option[DisplayMetadata] = None,
  )

  enum ChunkMaterial:
    case Stored(
        chunk: SeriesAnalysisStoredChunk,
        matchSnapshot: Option[SeriesAnalysisMatchSnapshot]
    )
    case Excluded(
        artifact: SeriesAnalysisArtifactRef,
        matchId: MatchId,
        reason: SeriesAnalysisMatchContextExclusion,
    )

  final case class DisplayMetadata(
      memberNames: Map[String, String],
      scopeName: Option[String],
      mapNames: Map[String, String]
  )

  private final case class MatchIdentityRow(
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      mapMasterId: MapMasterId,
      analysisRevision: Long,
      ownerMemberId: MemberId,
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
      mapIds: List[String],
  ): ConnectionIO[DisplayMetadata] =
    val ids = memberIds.toArray
    val scopeName = PostgresSeriesAnalysisScopeOps.displayName(artifact.gameTitleId, scope)
    val query = fr"SELECT m.id, m.display_name, scope.display_name FROM (SELECT" ++ scopeName ++
      fr"""AS display_name) scope
        LEFT JOIN members m ON m.id = ANY($ids)
      """
    for
      _ <- localStatementTimeout(config)
      rows <- query.query[(Option[MemberDisplayNameRow], Option[String])].nel
      maps <- if mapIds.isEmpty then Map.empty[String, String].pure[ConnectionIO]
      else
        val ids = mapIds.toArray
        PostgresReadBudget.rows[(String, String)](
          fr"""
          SELECT id, name FROM map_masters
          WHERE game_title_id = ${artifact.gameTitleId} AND id = ANY($ids)
        """,
          PostgresReadBudget.CatalogRows,
          "Analysis map display names"
        ).map(_.toMap)
    yield DisplayMetadata(
      rows.toList.flatMap(_._1).map(row => row.id -> row.displayName).toMap,
      rows.head._2,
      maps
    )

  private def localStatementTimeout(config: SeriesAnalysisReadConfig): ConnectionIO[Unit] =
    val value = s"${config.readTimeout.toMillis}ms"
    sql"SELECT set_config('statement_timeout', $value, true)".query[String].unique.void

  private def regularChunkCio(
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[Either[AppError, LoadedChunk]] =
    val exists = PostgresSeriesAnalysisScopeOps.valid(request.gameTitleId, request.scope)
    val preloadDisplayMetadata = request.kind == SeriesAnalysisChunkKind.OutlookReference &&
      request.scope == SeriesAnalysisScope.Overall && request.memberId.nonEmpty &&
      (request.projection match
        case SeriesAnalysisChunkProjection.OutlookExamples |
            SeriesAnalysisChunkProjection.OutlookWindow(_) => true
        case SeriesAnalysisChunkProjection.Stored => false)
    val memberExists = if preloadDisplayMetadata then fr"snapshot_member.id IS NOT NULL"
    else if request.kind == SeriesAnalysisChunkKind.OutlookReference then
      fr"EXISTS (SELECT 1 FROM members WHERE id = ${request.memberId.map(_.value)})"
    else fr"true"
    val memberColumns = if preloadDisplayMetadata then
      fr"snapshot_member.id, snapshot_member.display_name"
    else fr"NULL::text, NULL::text"
    val memberJoin = if preloadDisplayMetadata then
      fr"LEFT JOIN members snapshot_member ON snapshot_member.id = ${request.memberId.map(_.value)}"
    else Fragment.empty
    // An empty title has no aggregate scope index, but its no-target outlook summary is mandatory.
    val overallOutlook = request.kind == SeriesAnalysisChunkKind.OutlookSummary &&
      request.scope == SeriesAnalysisScope.Overall
    val query = fr"SELECT" ++ exists ++ fr"," ++ memberExists ++
      fr", ${request.scope.key} = ANY(a.scope_keys)," ++
      storedColumns(config) ++ fr"," ++ memberColumns ++
      readableArtifact(request) ++ chunkJoin(request) ++ memberJoin
    query.query[(
        Boolean,
        Boolean,
        Option[Boolean],
        Option[SeriesAnalysisStoredChunk],
        Option[MemberDisplayNameRow]
    )].unique.map {
      case (false, _, _, _, _) => AppError.AnalysisScopeNotFound().asLeft
      case (_, false, _, _, _) =>
        AppError.NotFound("member", request.memberId.fold("")(_.value)).asLeft
      case (_, _, _, None, _) => AppError.AnalysisArtifactExpired().asLeft
      case (_, _, indexed, Some(row), _)
          if row.scopeKind.isEmpty &&
            (overallOutlook ||
              (indexed.contains(true) &&
                (request.kind == SeriesAnalysisChunkKind.Aggregate ||
                  request.kind == SeriesAnalysisChunkKind.Review ||
                  request.kind == SeriesAnalysisChunkKind.OutlookSummary ||
                  request.kind == SeriesAnalysisChunkKind.OutlookReference))) =>
        AppError.Internal("A published analysis scope resource is missing.").asLeft
      case (_, _, Some(false), Some(row), _) if row.scopeKind.nonEmpty && !overallOutlook =>
        AppError.Internal("The published analysis scope index is inconsistent.").asLeft
      case (_, _, _, Some(row), member) =>
        val metadata = Option.when(preloadDisplayMetadata)(DisplayMetadata(
          member.toList.map(value => value.id -> value.displayName).toMap,
          Some("総合"),
          Map.empty,
        ))
        LoadedChunk(request, ChunkMaterial.Stored(row, None), metadata).asRight
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
    c.encoded_bytes, c.decoded_bytes, c.item_count, c.nesting_depth, c.checksum,
    rb.created_at, a.radar_applied_at
  """

  private def readableArtifact(request: SeriesAnalysisChunkRequest): Fragment =
    fr"""
    FROM (VALUES (${request.gameTitleId})) requested(game_title_id)
    LEFT JOIN series_analysis_title_states s ON s.game_title_id = requested.game_title_id
    LEFT JOIN series_analysis_artifacts a
      ON a.game_title_id = s.game_title_id
     AND a.id = ${request.artifactId}
     AND a.status = 'published'
     AND
  """ ++ readableContract ++
      fr"""
     AND a.id IN (s.current_artifact_id, s.previous_artifact_id)
     LEFT JOIN series_radar_bases rb ON rb.id = a.radar_basis_id AND rb.game_title_id = a.game_title_id
  """

  private val readableContract: Fragment = fr"""
    a.artifact_schema_version = ${SeriesAnalysisArtifactContract.ArtifactSchemaVersion}
    AND a.validation_contract_id = ${SeriesAnalysisArtifactContract.ValidationContractId}
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
    case SeriesAnalysisChunkKind.OutlookSummary => fr"""
        LEFT JOIN series_analysis_outlook_summary_artifacts c
          ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
      """
    case SeriesAnalysisChunkKind.OutlookReference => fr"""
        LEFT JOIN series_analysis_outlook_reference_artifacts c
          ON c.artifact_id = a.id AND c.scope_key = ${request.scope.key}
         AND c.member_id = ${request.memberId.map(_.value)}
      """

  private def matchContextCio(
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
  ): ConnectionIO[Either[AppError, LoadedChunk]] = request.matchId match
    case None => AppError.ValidationFailed("matchId is required.").asLeft.pure[ConnectionIO]
    case Some(matchId) =>
      val query =
        fr"""
        SELECT m.game_title_id, m.season_master_id, m.map_master_id, m.analysis_revision, m.owner_member_id,
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
              else if !request.scope.contains(
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
            val material = exclusion.fold[ChunkMaterial](ChunkMaterial.Stored(
              row,
              sourceRevision.map(SeriesAnalysisMatchSnapshot(_, current.ownerMemberId)),
            ))(reason => ChunkMaterial.Excluded(row.artifact, matchId, reason))
            LoadedChunk(request, material).asRight
        }

end PostgresSeriesAnalysisChunkOps
