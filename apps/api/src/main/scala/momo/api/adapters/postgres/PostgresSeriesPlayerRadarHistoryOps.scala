package momo.api.adapters.postgres

import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.domain.*
import momo.api.errors.AppError

private[postgres] object PostgresSeriesPlayerRadarHistoryOps:
  private val summary =
    fr"""jsonb_build_object(
    'revisionId', r.operation_id, 'gameTitleId', r.game_title_id,
    'gameTitleName', gt.name, 'kind', r.change_kind, 'appliedAt', r.published_at,
    'appliedBy', jsonb_build_object('accountId', r.requested_by, 'displayName', r.requested_by_display_name),
    'savedBy', CASE WHEN r.saved_by IS NULL THEN NULL ELSE jsonb_build_object(
      'accountId', r.saved_by, 'displayName', r.saved_by_display_name) END,
    'beforeBasisId', r.before_basis_id, 'afterBasisId', r.after_basis_id,
    'sourceBasisId', c.source_basis_id, 'sourceCandidateId', c.source_candidate_id)"""
  private def joins(using identities: PostgresIdentities) = fr"""FROM series_radar_revisions r
    JOIN game_titles gt ON ${identities.wireId("gt")} = r.game_title_id
    JOIN series_radar_candidates c ON ${identities.wireId(
      "c"
    )} = r.candidate_id AND ${identities.retainedColumn("c", "game_title_id")} = r.game_title_id"""

  def list(request: SeriesPlayerRadarHistoryRequest)(using identities: PostgresIdentities)
      : ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    val title = request.gameTitleId.fold(Fragment.empty)(id =>
      fr"AND r.game_title_id = ${identities.wireReference(Entity.GameTitles, identities.lookup(Entity.GameTitles, id.value))}"
    )
    val cursor =
      request.cursor.fold(Fragment.empty)(id =>
        fr"""AND (r.published_at, r.operation_id) < (
      SELECT published_at, operation_id FROM series_radar_revisions WHERE operation_id = ${identities.wireReference(
            Entity.RadarOperations,
            identities.lookup(Entity.RadarOperations, id)
          )})"""
      )
    val query = fr"""WITH selected AS (SELECT r.operation_id, r.published_at,""" ++ summary ++
      fr" AS item " ++ joins ++ fr" WHERE true " ++ title ++ cursor ++
      fr"""ORDER BY r.published_at DESC, r.operation_id DESC LIMIT ${request.limit + 1}),
      ranked AS (SELECT *, row_number() OVER (ORDER BY published_at DESC, operation_id DESC) AS rn FROM selected)
      SELECT jsonb_build_object('schemaVersion', 1,
        'items', COALESCE(jsonb_agg(item ORDER BY rn) FILTER (WHERE rn <= ${request.limit}), '[]'::jsonb),
        'nextCursor', CASE WHEN count(*) > ${request.limit} THEN
          max(operation_id) FILTER (WHERE rn = ${request.limit}) ELSE NULL END) AS document FROM ranked"""
    PostgresSeriesPlayerRadarReadOps.document(
      query,
      AppError.Internal("Radar history could not be read.")
    )

  def detail(id: String)(using
      identities: PostgresIdentities): ConnectionIO[Either[AppError, SeriesPlayerRadarDocument]] =
    val query = fr"SELECT jsonb_build_object('schemaVersion', 1, 'revision'," ++ summary ++
      fr""", 'beforeBasis', bb.payload, 'afterBasis', ab.payload,
        'beforeAchievementCurve', CASE WHEN bb.id IS NULL THEN NULL ELSE COALESCE(bb.payload->'achievementCurve', ${PostgresSeriesPlayerRadarReadOps.LegacyDefaultAchievementCurve.noSpaces}::jsonb) END,
        'afterAchievementCurve', COALESCE(ab.payload->'achievementCurve', ${PostgresSeriesPlayerRadarReadOps.LegacyDefaultAchievementCurve.noSpaces}::jsonb)) AS document """ ++
      joins ++
      fr""" LEFT JOIN series_radar_bases bb ON bb.id = r.before_basis_id AND bb.game_title_id = r.game_title_id
      JOIN series_radar_bases ab ON ab.id = r.after_basis_id AND ab.game_title_id = r.game_title_id
      WHERE r.operation_id = ${identities.wireReference(
          Entity.RadarOperations,
          identities.lookup(Entity.RadarOperations, id)
        )}"""
    PostgresSeriesPlayerRadarReadOps.document(query, AppError.NotFound("radar revision", id))
