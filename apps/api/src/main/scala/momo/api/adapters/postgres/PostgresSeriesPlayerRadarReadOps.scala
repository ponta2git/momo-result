package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json
import io.circe.parser.parse

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.GameTitleId
import momo.api.errors.AppError

private[postgres] object PostgresSeriesPlayerRadarReadOps:
  val MaximumDocumentBytes = 262144
  val DefaultAchievementCurve: Json = Json.obj(
    "thresholds" -> Json.fromValues(
      SeriesPlayerRadarAchievementCurve.Default.thresholds.map(Json.fromDoubleOrNull)
    )
  )

  def operationColumns(using identities: PostgresIdentities): Fragment = fr"""
    ${identities.wireId("o")}, ${identities.retainedColumn("o", "game_title_id")}, o.kind, o.status,
    ${identities.wireReference(Entity.RadarCandidates, fr"o.candidate_id")},
    ${identities.wireReference(Entity.RadarPreviews, fr"o.preview_id")},
    ${identities.wireReference(Entity.RadarBases, fr"o.basis_id")},
    ${identities.retainedColumn(
      "o",
      "origin_operation_id"
    )}, o.safe_failure_code, o.requested_at, o.finished_at
  """

  def operation(
      title: GameTitleId,
      id: String,
  )(using
      identities: PostgresIdentities): ConnectionIO[Either[AppError, SeriesPlayerRadarOperation]] =
    (fr"SELECT" ++ operationColumns ++ fr"""
      FROM series_radar_operations o WHERE o.game_title_id = ${identities.lookup(
        Entity.GameTitles,
        title.value
      )} AND o.id = ${identities.lookup(Entity.RadarOperations, id)}
    """).query[SeriesPlayerRadarOperation].option.map(
      _.toRight(AppError.NotFound("radar operation", id))
    )

  /** All selected payloads are bounded summaries; source/evaluation snapshots stay in the Worker. */
  def state(title: GameTitleId)(using
      identities: PostgresIdentities): ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    val query = fr"""
      SELECT jsonb_build_object(
        'schemaVersion', 1, 'gameTitleId', ${identities.wireId("gt")},
        'inputRevision', a.input_revision::text,
        'generation', COALESCE(r.generation, 0)::text,
        'currentBasis', CASE WHEN cb.id IS NULL THEN NULL ELSE jsonb_build_object(
          'basisId', cb.id, 'checksum', cb.checksum, 'createdAt', cb.created_at,
          'appliedAt', r.current_applied_at, 'sourceInputRevision', cb.source_input_revision::text,
          'basis', cb.payload, 'achievementCurve', COALESCE(cb.payload->'achievementCurve', ${DefaultAchievementCurve.noSpaces}::jsonb)) END,
        'previousBasis', CASE WHEN pb.id IS NULL THEN NULL ELSE jsonb_build_object(
          'basisId', pb.id, 'checksum', pb.checksum, 'createdAt', pb.created_at,
          'appliedAt', r.previous_applied_at, 'sourceInputRevision', pb.source_input_revision::text,
          'basis', pb.payload, 'achievementCurve', COALESCE(pb.payload->'achievementCurve', ${DefaultAchievementCurve.noSpaces}::jsonb)) END,
        'candidate', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'candidateId', ${identities.wireId(
        "c"
      )}, 'status', c.status, 'basisId', ${identities.wireReference(
        Entity.RadarBases,
        fr"c.basis_id"
      )},
          'sourceInputRevision', c.source_input_revision::text,
          'safeFailureCode', c.safe_failure_code, 'createdAt', c.created_at,
          'updatedAt', c.updated_at, 'result', c.result,
          'originKind', c.origin_kind, 'manualInput', c.manual_input,
          'achievementCurve', COALESCE(c.manual_input->'achievementCurve', c.result->'basis'->'achievementCurve', sb.payload->'achievementCurve', ${DefaultAchievementCurve.noSpaces}::jsonb),
          'sourceBasisId', c.source_basis_id, 'sourceCandidateId', c.source_candidate_id,
          'savedBy', CASE WHEN c.saved_by IS NULL THEN NULL ELSE jsonb_build_object(
            'accountId', c.saved_by, 'displayName', c.saved_by_display_name) END,
          'sourceBasis', CASE WHEN sb.id IS NULL THEN NULL ELSE jsonb_build_object(
            'basisId', sb.id, 'checksum', sb.checksum, 'createdAt', sb.created_at,
            'appliedAt', NULL, 'sourceInputRevision', sb.source_input_revision::text,
            'basis', sb.payload, 'achievementCurve', COALESCE(sb.payload->'achievementCurve', ${DefaultAchievementCurve.noSpaces}::jsonb)) END,
          'latestPreview', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
            'previewId', ${identities.wireId("p")}, 'beforeBasisId', ${identities.wireReference(
        Entity.RadarBases,
        fr"p.before_basis_id"
      )},
            'inputRevision', p.input_revision::text,
            'status', CASE WHEN p.status = 'ready' AND (
              p.before_basis_id IS DISTINCT FROM r.current_basis_id OR p.evaluation_snapshot->'achievements' IS NULL
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
      LEFT JOIN series_radar_bases cb ON cb.id = ${identities.wireReference(
        Entity.RadarBases,
        fr"r.current_basis_id"
      )} AND cb.game_title_id = ${identities.wireId("gt")}
      LEFT JOIN series_radar_bases pb ON pb.id = ${identities.wireReference(
        Entity.RadarBases,
        fr"r.previous_basis_id"
      )} AND pb.game_title_id = ${identities.wireId("gt")}
      LEFT JOIN LATERAL (
        SELECT candidate.* FROM series_radar_candidates candidate WHERE game_title_id = gt.id
        ORDER BY created_at DESC, ${identities.wireId("candidate")} DESC LIMIT 1
      ) c ON true
      LEFT JOIN series_radar_bases sb ON sb.id = c.source_basis_id AND sb.game_title_id = ${identities.wireId(
        "gt"
      )}
      LEFT JOIN LATERAL (
        SELECT preview.* FROM series_radar_previews preview WHERE candidate_id = c.id AND game_title_id = gt.id
        ORDER BY created_at DESC, ${identities.wireId("preview")} DESC LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'schemaVersion', 1, 'operationId', ${identities.wireId(
        "o"
      )}, 'gameTitleId', ${identities.retainedColumn("o", "game_title_id")},
          'kind', o.kind, 'status', o.status, 'candidateId', ${identities.wireReference(
        Entity.RadarCandidates,
        fr"o.candidate_id"
      )},
          'previewId', ${identities.wireReference(
        Entity.RadarPreviews,
        fr"o.preview_id"
      )}, 'basisId', ${identities.wireReference(Entity.RadarBases, fr"o.basis_id")},
          'originOperationId', ${identities.retainedColumn(
        "o",
        "origin_operation_id"
      )}, 'safeFailureCode', o.safe_failure_code,
          'requestedAt', o.requested_at, 'finishedAt', o.finished_at)
          ORDER BY o.requested_at DESC, ${identities.wireId("o")} DESC) AS items
        FROM (SELECT operation.* FROM series_radar_operations operation WHERE game_title_id = gt.id
              ORDER BY requested_at DESC, ${identities.wireId("operation")} DESC LIMIT 10) o
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
      WHERE gt.id = ${identities.lookup(Entity.GameTitles, title.value)}
    """
    document(query, AppError.NotFound("game title", title.value))

  def preview(
      request: SeriesPlayerRadarPreviewRequest
  )(using
      identities: PostgresIdentities): ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    PostgresSeriesAnalysisScopeOps.normalize(request.scope).flatMap(scope =>
      previewNormalized(request.copy(scope = scope))
    )

  private def previewNormalized(request: SeriesPlayerRadarPreviewRequest)(using
      identities: PostgresIdentities): ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    val validScope = PostgresSeriesAnalysisScopeOps.valid(request.gameTitleId, request.scope)
    val scopeName = PostgresSeriesAnalysisScopeOps.displayName(request.gameTitleId, request.scope)
    val scope = request.scope
    val query =
      fr"""
      SELECT jsonb_build_object(
        'schemaVersion', 1, 'gameTitleId', ${identities.wireReference(
          Entity.GameTitles,
          fr"p.game_title_id"
        )}, 'previewId', ${identities.wireId("p")},
        'candidateId', ${identities.wireReference(
          Entity.RadarCandidates,
          fr"p.candidate_id"
        )}, 'inputRevision', p.input_revision::text,
        'currentInputRevision', a.input_revision::text,
        'beforeBasisId', ${identities.wireReference(
          Entity.RadarBases,
          fr"p.before_basis_id"
        )}, 'candidateBasisId', ${identities.wireReference(Entity.RadarBases, fr"c.basis_id")},
        'status', CASE WHEN c.status = 'invalid' THEN 'invalid'
          WHEN p.status = 'ready' AND
            (p.before_basis_id IS DISTINCT FROM r.current_basis_id OR p.evaluation_snapshot->'achievements' IS NULL) THEN 'stale'
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
        'before', s.payload->'before', 'after', s.payload->'after',
        'beforeAchievements', s.payload->'beforeAchievements', 'afterAchievements', s.payload->'afterAchievements'
      ) AS document
      FROM series_radar_previews p
      JOIN series_analysis_title_states a ON a.game_title_id = p.game_title_id
      JOIN series_radar_candidates c ON c.id = p.candidate_id AND c.game_title_id = p.game_title_id
      LEFT JOIN series_radar_title_states r ON r.game_title_id = p.game_title_id
      LEFT JOIN series_radar_preview_scopes s ON s.preview_id = p.id AND s.scope_key = ${scope.key}
      WHERE p.game_title_id = ${identities.lookup(
          Entity.GameTitles,
          request.gameTitleId.value
        )} AND p.id = ${identities.lookup(Entity.RadarPreviews, request.previewId)}
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
  def document(
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
