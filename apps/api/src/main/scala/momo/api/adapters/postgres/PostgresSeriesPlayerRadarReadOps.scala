package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json
import io.circe.parser.parse

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.GameTitleId
import momo.api.errors.AppError

private[postgres] object PostgresSeriesPlayerRadarReadOps:
  val MaximumDocumentBytes = 262144

  val operationColumns: Fragment = fr"""
    id, game_title_id, kind, status, candidate_id, preview_id, basis_id,
    origin_operation_id, safe_failure_code, requested_at, finished_at
  """

  def operation(
      title: GameTitleId,
      id: String,
  ): ConnectionIO[Either[AppError, SeriesPlayerRadarOperation]] =
    (fr"SELECT" ++ operationColumns ++ fr"""
      FROM series_radar_operations WHERE game_title_id = $title AND id = $id
    """).query[SeriesPlayerRadarOperation].option.map(
      _.toRight(AppError.NotFound("radar operation", id))
    )

  /** All selected payloads are bounded summaries; source/evaluation snapshots stay in the Worker. */
  def state(title: GameTitleId): ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    val query = fr"""
      SELECT jsonb_build_object(
        'schemaVersion', 1, 'gameTitleId', gt.id,
        'inputRevision', a.input_revision::text,
        'generation', COALESCE(r.generation, 0)::text,
        'currentBasis', CASE WHEN cb.id IS NULL THEN NULL ELSE jsonb_build_object(
          'basisId', cb.id, 'checksum', cb.checksum, 'createdAt', cb.created_at,
          'appliedAt', r.current_applied_at, 'sourceInputRevision', cb.source_input_revision::text,
          'basis', cb.payload) END,
        'previousBasis', CASE WHEN pb.id IS NULL THEN NULL ELSE jsonb_build_object(
          'basisId', pb.id, 'checksum', pb.checksum, 'createdAt', pb.created_at,
          'appliedAt', r.previous_applied_at, 'sourceInputRevision', pb.source_input_revision::text,
          'basis', pb.payload) END,
        'candidate', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'candidateId', c.id, 'status', c.status, 'basisId', c.basis_id,
          'sourceInputRevision', c.source_input_revision::text,
          'safeFailureCode', c.safe_failure_code, 'createdAt', c.created_at,
          'updatedAt', c.updated_at, 'result', c.result,
          'latestPreview', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
            'previewId', p.id, 'beforeBasisId', p.before_basis_id,
            'inputRevision', p.input_revision::text,
            'status', CASE WHEN p.status = 'ready' AND (
              p.before_basis_id IS DISTINCT FROM r.current_basis_id
            ) THEN 'stale' ELSE p.status END,
            'createdAt', p.created_at) END) END,
        'operations', COALESCE(ops.items, '[]'::jsonb),
        'monitor', r.monitor,
        'acknowledgedEvidenceKeys', COALESCE(ack.keys, '[]'::jsonb),
        'eligibility', jsonb_build_object(
          'matchCount', counts.match_count, 'heldEventCount', counts.held_event_count)
      ) AS document
      FROM game_titles gt
      JOIN series_analysis_title_states a ON a.game_title_id = gt.id
      LEFT JOIN series_radar_title_states r ON r.game_title_id = gt.id
      LEFT JOIN series_radar_bases cb ON cb.id = r.current_basis_id AND cb.game_title_id = gt.id
      LEFT JOIN series_radar_bases pb ON pb.id = r.previous_basis_id AND pb.game_title_id = gt.id
      LEFT JOIN LATERAL (
        SELECT id, status, basis_id, source_input_revision, safe_failure_code,
               created_at, updated_at, result
        FROM series_radar_candidates WHERE game_title_id = gt.id
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT id, before_basis_id, input_revision, status, created_at
        FROM series_radar_previews WHERE candidate_id = c.id AND game_title_id = gt.id
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'schemaVersion', 1, 'operationId', o.id, 'gameTitleId', o.game_title_id,
          'kind', o.kind, 'status', o.status, 'candidateId', o.candidate_id,
          'previewId', o.preview_id, 'basisId', o.basis_id,
          'originOperationId', o.origin_operation_id, 'safeFailureCode', o.safe_failure_code,
          'requestedAt', o.requested_at, 'finishedAt', o.finished_at)
          ORDER BY o.requested_at DESC, o.id DESC) AS items
        FROM (SELECT id, game_title_id, kind, status, candidate_id, preview_id, basis_id,
                     origin_operation_id, safe_failure_code, requested_at, finished_at
              FROM series_radar_operations WHERE game_title_id = gt.id
              ORDER BY requested_at DESC, id DESC LIMIT 10) o
      ) ops ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(evidence_key ORDER BY evidence_key) AS keys
        FROM series_radar_acknowledgements
        WHERE game_title_id = gt.id AND evidence_key IN (
          SELECT value->>'evidenceChecksum'
          FROM jsonb_array_elements(COALESCE(r.monitor->'reasons', '[]'::jsonb))
        )
      ) ack ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::bigint AS match_count,
               count(DISTINCT held_event_id)::bigint AS held_event_count
        FROM matches WHERE game_title_id = gt.id
      ) counts ON true
      WHERE gt.id = $title
    """
    document(query, AppError.NotFound("game title", title.value))

  def preview(
      request: SeriesPlayerRadarPreviewRequest
  ): ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    val validScope = PostgresSeriesAnalysisScopeOps.valid(request.gameTitleId, request.scope)
    val scopeName = PostgresSeriesAnalysisScopeOps.displayName(request.gameTitleId, request.scope)
    val scope = request.scope
    val query =
      fr"""
      SELECT jsonb_build_object(
        'schemaVersion', 1, 'gameTitleId', p.game_title_id, 'previewId', p.id,
        'candidateId', p.candidate_id, 'inputRevision', p.input_revision::text,
        'currentInputRevision', a.input_revision::text,
        'beforeBasisId', p.before_basis_id, 'candidateBasisId', c.basis_id,
        'status', CASE WHEN c.status = 'invalid' THEN 'invalid'
          WHEN p.status = 'ready' AND
            p.before_basis_id IS DISTINCT FROM r.current_basis_id THEN 'stale'
          ELSE p.status END,
        'createdAt', p.created_at,
        'scope', jsonb_build_object(
          'kind', ${scope.kind}, 'key', ${scope.key},
          'seasonMasterId', ${scope.seasonMasterId.map(_.value)},
          'mapMasterId', ${scope.mapMasterId.map(_.value)}, 'displayName',
    """ ++ scopeName ++ fr""",
          'state', CASE WHEN NOT (
    """ ++ validScope ++ fr"""
          ) THEN 'invalid'
          WHEN p.status <> 'ready' THEN 'awaiting_analysis'
          WHEN ${scope.key} = ANY(p.scope_keys) AND s.payload IS NULL THEN 'unavailable'
          WHEN ${scope.key} = ANY(p.scope_keys) THEN 'available' ELSE 'empty' END),
        'before', s.payload->'before', 'after', s.payload->'after'
      ) AS document
      FROM series_radar_previews p
      JOIN series_analysis_title_states a ON a.game_title_id = p.game_title_id
      JOIN series_radar_candidates c ON c.id = p.candidate_id AND c.game_title_id = p.game_title_id
      LEFT JOIN series_radar_title_states r ON r.game_title_id = p.game_title_id
      LEFT JOIN series_radar_preview_scopes s ON s.preview_id = p.id AND s.scope_key = ${scope.key}
      WHERE p.game_title_id = ${request.gameTitleId} AND p.id = ${request.previewId}
    """
    document(query, AppError.NotFound("radar preview", request.previewId)).map(_.flatMap { value =>
      parse(new String(value.payload, java.nio.charset.StandardCharsets.UTF_8))
        .leftMap(_ => AppError.Internal("Invalid saved radar preview."))
        .flatMap(json =>
          json.hcursor.downField("scope").get[String]("state").toOption match
            case Some("unavailable") =>
              Left(AppError.Internal("A saved radar preview scope is missing."))
            case Some("invalid") => Left(AppError.AnalysisScopeNotFound())
            case _ => Right(value)
        )
    })

  /** SQL truncates before JDBC allocation, and rendering independently admits the final bytes. */
  private def document(
      query: Fragment,
      missing: AppError,
  ): ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    (fr"SELECT CASE WHEN octet_length(document::text) <= $MaximumDocumentBytes" ++
      fr"THEN document::text ELSE NULL END FROM (" ++ query ++ fr") saved_radar")
      .query[Option[String]].option.map {
        case None => Left(missing)
        case Some(None) =>
          Left(AppError.PayloadTooLarge("Saved radar data exceeds its read bound."))
        case Some(Some(value)) => parse(value)
            .leftMap(_ => AppError.Internal("Invalid saved radar data."))
            .flatMap(validateSummary)
            .flatMap(PostgresSeriesAnalysisChunkCodec.renderJson(_, MaximumDocumentBytes))
            .map(SeriesPlayerRadarDocument.apply)
      }

  private def validateSummary(value: Json): Either[AppError, Json] =
    val forbidden = Set("sourceSnapshot", "evaluationSnapshot", "matches")
    def safe(json: Json, depth: Int): Boolean =
      depth <= 24 && json.arrayOrObject(
        true,
        _.forall(safe(_, depth + 1)),
        fields =>
          !fields.keys.exists(forbidden.contains) && fields.values.forall(safe(_, depth + 1)),
      )
    Either.cond(
      safe(value, 0) && SeriesPlayerRadarPayloadValidator.validate(value),
      value,
      AppError.Internal("Invalid radar summary shape.")
    )
