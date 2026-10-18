package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisReadOps:
  private final case class TitleOptionRow(
      gameTitleId: GameTitleId,
      displayName: String,
      displayOrder: Int,
      confirmedMatchCount: Long,
      latestPlayedAt: Option[Instant],
  )

  private final case class ScopeOptionRow(
      seasonMasterId: SeasonMasterId,
      seasonName: String,
      seasonOrder: Int,
      mapMasterId: MapMasterId,
      mapName: String,
      mapOrder: Int,
  )

  def options(using
      identities: PostgresIdentities): ConnectionIO[Either[AppError, SeriesAnalysisOptions]] =
    sql"""
        WITH match_scopes AS MATERIALIZED (
          SELECT game_title_id, season_master_id, map_master_id,
                 COUNT(*)::bigint AS match_count, MAX(played_at) AS latest_played_at
          FROM matches
          GROUP BY game_title_id, season_master_id, map_master_id
        ), title_matches AS (
          SELECT game_title_id, SUM(match_count)::bigint AS match_count,
                 MAX(latest_played_at) AS latest_played_at
          FROM match_scopes
          GROUP BY game_title_id
        )
        SELECT
          ${identities.wireId("gt")},
          gt.name,
          gt.display_order,
          COALESCE(tm.match_count, 0)::bigint,
          tm.latest_played_at,
          ${identities.wireId("sm")},
          sm.name,
          sm.display_order,
          ${identities.wireId("mm")},
          mm.name,
          mm.display_order
        FROM game_titles gt
        LEFT JOIN title_matches tm ON tm.game_title_id = gt.id
        LEFT JOIN match_scopes ms ON ms.game_title_id = gt.id
        LEFT JOIN season_masters sm ON sm.id = ms.season_master_id
        LEFT JOIN map_masters mm ON mm.id = ms.map_master_id
        ORDER BY
          gt.display_order,
          ${identities.wireId("gt")},
          sm.display_order,
          ${identities.wireId("sm")},
          mm.display_order,
          ${identities.wireId("mm")}
      """.query[(TitleOptionRow, Option[ScopeOptionRow])].to[List].map { selections =>
      // Counts and scope candidates come from the same scan and statement snapshot.
      val titles = selections.map(_._1).distinct
      val byTitle = selections.groupMap(_._1.gameTitleId)(_._2).view.mapValues(_.flatten).toMap
      val options = titles.map { title =>
        val rows = byTitle.getOrElse(title.gameTitleId, Nil)
        val seasons = rows
          .map(row => (row.seasonOrder, row.seasonMasterId, row.seasonName)).distinct
          .sortBy(value => (value._1, value._2.value))
          .map(value => SeriesAnalysisSeasonOption(value._2, value._3))
        val maps = rows.map(row => (row.mapOrder, row.mapMasterId, row.mapName)).distinct
          .sortBy(value => (value._1, value._2.value))
          .map(value => SeriesAnalysisMapOption(value._2, value._3))
        val pairs = rows.map(row =>
          SeriesAnalysisSeasonMapPair(row.seasonMasterId, row.mapMasterId)
        )
        SeriesAnalysisTitleOption(
          title.gameTitleId,
          title.displayName,
          title.confirmedMatchCount,
          seasons,
          maps,
          pairs,
        )
      }
      val default = titles.filter(_.latestPlayedAt.nonEmpty)
        .sortBy(row => (row.latestPlayedAt.get, -row.displayOrder, row.gameTitleId.value))
        .lastOption.map(_.gameTitleId).orElse(titles.headOption.map(_.gameTitleId))
      SeriesAnalysisOptions(default, options).asRight[AppError]
    }

  private final case class StateRow(
      inputRevision: Long,
      algorithmVersion: String,
      artifactSchemaVersion: Int,
      desiredValidationContractId: Option[String],
      pendingWork: Boolean,
      currentArtifactId: Option[String],
      artifactGameTitleId: Option[GameTitleId],
      artifactInputRevision: Option[Long],
      artifactAlgorithmVersion: Option[String],
      artifactSchemaVersionValue: Option[Int],
      artifactValidationContractId: Option[String],
      artifactPublishedAt: Option[Instant],
      radarBasisCreatedAt: Option[Instant],
      radarBasisAppliedAt: Option[Instant],
      radarMatches: Boolean,
  )

  private final case class PendingProjectionRow(trigger: String, acceptedAt: Instant)

  def status(
      gameTitleId: GameTitleId
  )(using identities: PostgresIdentities): ConnectionIO[Either[AppError, SeriesAnalysisStatus]] =
    // A single statement prevents a publication or job transition from producing a mixed status.
    sql"""
        SELECT
          ${identities.wireId("gt")},
          s.input_revision,
          s.algorithm_version,
          s.artifact_schema_version,
          s.validation_contract_id,
          s.pending_work,
          a.id,
          a.game_title_id,
          a.input_revision,
          a.algorithm_version,
          a.artifact_schema_version,
          a.validation_contract_id,
          a.published_at,
          rb.created_at, a.radar_applied_at,
          (a.radar_basis_id IS NOT DISTINCT FROM ${identities.wireReference(
        Entity.RadarBases,
        fr"r.desired_basis_id"
      )} AND
            COALESCE(a.radar_generation, 0) = COALESCE(r.generation, 0)),
          COALESCE(active.status, latest.status), COALESCE(active.trigger, latest.trigger),
          COALESCE(active.requested_at, latest.requested_at),
          COALESCE(active.started_at, latest.started_at), COALESCE(active.finished_at, latest.finished_at),
          p.trigger, p.accepted_at
        FROM game_titles gt
        LEFT JOIN series_analysis_title_states s ON s.game_title_id = gt.id
        LEFT JOIN series_analysis_artifacts a ON a.id = ${identities.wireReference(
        Entity.AnalysisArtifacts,
        fr"s.current_artifact_id"
      )}
        LEFT JOIN series_radar_title_states r ON r.game_title_id = gt.id
        LEFT JOIN series_radar_bases rb ON rb.id = a.radar_basis_id AND rb.game_title_id = ${identities.wireId(
        "gt"
      )}
        LEFT JOIN LATERAL (
          SELECT id, status, trigger, requested_at, started_at, finished_at
          FROM series_analysis_jobs j
          WHERE game_title_id = gt.id AND work_kind = 'analysis'
            AND status IN ('running', 'queued')
        ) active ON true
        LEFT JOIN LATERAL (
          SELECT status, trigger, requested_at, started_at, finished_at
          FROM series_analysis_jobs j
          WHERE game_title_id = gt.id AND work_kind = 'analysis'
            AND status IN ('succeeded', 'failed', 'timed_out')
            AND active.id IS NULL
          ORDER BY finished_at DESC NULLS LAST, ${identities.wireId("j")} DESC
          LIMIT 1
        ) latest ON true
        LEFT JOIN LATERAL (
          SELECT trigger, accepted_at
          FROM series_analysis_job_requests jr
          WHERE game_title_id = gt.id
            AND status = 'pending'
            AND assigned_job_id IS NULL
          ORDER BY accepted_at, ${identities.wireId("jr")}
          LIMIT 1
        ) p ON true
        WHERE gt.id = ${identities.lookup(Entity.GameTitles, gameTitleId.value)}
      """.query[(
        GameTitleId,
        Option[StateRow],
        Option[SeriesAnalysisCalculation],
        Option[PendingProjectionRow]
    )]
      .option.map {
        case None => AppError.NotFound("game title", gameTitleId.value).asLeft
        case Some((_, None, _, _)) => AppError.AnalysisStateUnavailable().asLeft
        case Some((wireTitleId, Some(row), activeOrLatest, pending)) =>
          buildStatus(wireTitleId, row, activeOrLatest, pending)
      }

  private def buildStatus(
      gameTitleId: GameTitleId,
      row: StateRow,
      activeOrLatest: Option[SeriesAnalysisCalculation],
      pending: Option[PendingProjectionRow],
  ): Either[AppError, SeriesAnalysisStatus] =
    val desired = SeriesAnalysisDesiredVersion(
      row.inputRevision,
      row.algorithmVersion,
      row.artifactSchemaVersion,
    )
    val artifact = (
      row.currentArtifactId,
      row.artifactGameTitleId,
      row.artifactInputRevision,
      row.artifactAlgorithmVersion,
      row.artifactSchemaVersionValue,
      row.artifactPublishedAt,
    ).tupled.map { case (id, titleId, revision, algorithm, schema, publishedAt) =>
      SeriesAnalysisArtifactRef(
        id,
        titleId,
        revision,
        algorithm,
        schema,
        publishedAt,
        row.radarBasisCreatedAt,
        row.radarBasisAppliedAt
      )
    }
    val supported = SeriesAnalysisArtifactContract.supports(
      row.artifactSchemaVersion,
      row.desiredValidationContractId,
    ) && artifact.forall(value =>
      SeriesAnalysisArtifactContract.supports(
        value.artifactSchemaVersion,
        row.artifactValidationContractId,
      )
    )
    Option.when(supported)(()).flatMap(_ =>
      SeriesAnalysisStatus.project(
        gameTitleId,
        desired,
        artifact,
        row.desiredValidationContractId == row.artifactValidationContractId && row.radarMatches,
        row.pendingWork,
        activeOrLatest,
        pending.map(value =>
          SeriesAnalysisCalculation("queued", value.trigger, value.acceptedAt, None, None)
        ),
      )
    ).toRight(AppError.AnalysisStateUnavailable())

end PostgresSeriesAnalysisReadOps
