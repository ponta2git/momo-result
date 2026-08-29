package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MapMasterId, SeasonMasterId}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisReadOps:
  private val AllowedJobStatuses = SeriesAnalysisVocabulary.JobStatuses.toSet
  private val AllowedTriggers = SeriesAnalysisVocabulary.StoredTriggersByPriority.toSet

  private final case class TitleOptionRow(
      gameTitleId: GameTitleId,
      displayName: String,
      displayOrder: Int,
      confirmedMatchCount: Long,
      latestPlayedAt: Option[Instant],
  )

  private final case class ScopeOptionRow(
      gameTitleId: GameTitleId,
      seasonMasterId: SeasonMasterId,
      seasonName: String,
      seasonOrder: Int,
      mapMasterId: MapMasterId,
      mapName: String,
      mapOrder: Int,
  )

  def options: ConnectionIO[Either[AppError, SeriesAnalysisOptions]] =
    for
      titles <- sql"""
        SELECT
          gt.id,
          gt.name,
          gt.display_order,
          COUNT(m.id)::bigint,
          MAX(m.played_at)
        FROM game_titles gt
        LEFT JOIN matches m ON m.game_title_id = gt.id
        GROUP BY gt.id, gt.name, gt.display_order
        ORDER BY gt.display_order, gt.id
      """.query[TitleOptionRow].to[List]
      scopes <- sql"""
        SELECT
          m.game_title_id,
          sm.id,
          sm.name,
          sm.display_order,
          mm.id,
          mm.name,
          mm.display_order
        FROM matches m
        JOIN season_masters sm ON sm.id = m.season_master_id
        JOIN map_masters mm ON mm.id = m.map_master_id
        GROUP BY
          m.game_title_id,
          sm.id,
          sm.name,
          sm.display_order,
          mm.id,
          mm.name,
          mm.display_order
        ORDER BY
          m.game_title_id,
          sm.display_order,
          sm.id,
          mm.display_order,
          mm.id
      """.query[ScopeOptionRow].to[List]
    yield
      val byTitle = scopes.groupBy(_.gameTitleId)
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
  )

  private final case class CalculationRow(
      status: String,
      trigger: String,
      requestedAt: Instant,
      startedAt: Option[Instant],
      finishedAt: Option[Instant],
  )

  private final case class PendingProjectionRow(trigger: String, acceptedAt: Instant)

  def status(
      gameTitleId: GameTitleId
  ): ConnectionIO[Either[AppError, SeriesAnalysisStatus]] =
    for
      titleExists <- sql"SELECT EXISTS(SELECT 1 FROM game_titles WHERE id = $gameTitleId)"
        .query[Boolean].unique
      state <- sql"""
        SELECT
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
          a.published_at
        FROM series_analysis_title_states s
        LEFT JOIN series_analysis_artifacts a ON a.id = s.current_artifact_id
        WHERE s.game_title_id = $gameTitleId
      """.query[StateRow].option
      activeOrLatest <- sql"""
        SELECT status, trigger, requested_at, started_at, finished_at
        FROM series_analysis_jobs
        WHERE game_title_id = $gameTitleId
        ORDER BY
          CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
          CASE WHEN status IN ('running', 'queued') THEN requested_at END ASC NULLS LAST,
          finished_at DESC NULLS LAST,
          id DESC
        LIMIT 1
      """.query[CalculationRow].option
      pending <- sql"""
        SELECT trigger, accepted_at
        FROM series_analysis_job_requests
        WHERE game_title_id = $gameTitleId
          AND status = 'pending'
          AND assigned_job_id IS NULL
        ORDER BY accepted_at, id
        LIMIT 1
      """.query[PendingProjectionRow].option
    yield
      if !titleExists then AppError.NotFound("game title", gameTitleId.value).asLeft
      else
        state match
          case None => AppError.AnalysisStateUnavailable().asLeft
          case Some(row) => buildStatus(gameTitleId, row, activeOrLatest, pending)

  private def buildStatus(
      gameTitleId: GameTitleId,
      row: StateRow,
      activeOrLatest: Option[CalculationRow],
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
      SeriesAnalysisArtifactRef(id, titleId, revision, algorithm, schema, publishedAt)
    }
    val freshness = artifact match
      case None => "unavailable"
      case Some(value)
          if value.inputRevision == desired.inputRevision &&
            value.algorithmVersion == desired.algorithmVersion &&
            value.artifactSchemaVersion == desired.artifactSchemaVersion &&
            SeriesAnalysisArtifactSupport.satisfiesDesired(
              row.desiredValidationContractId,
              row.artifactValidationContractId,
            ) => "current"
      case Some(_) => "stale"
    val active = activeOrLatest.filter(row => row.status == "running" || row.status == "queued")
    val storedCalculation = active.orElse(pending.map(value =>
      CalculationRow("queued", value.trigger, value.acceptedAt, None, None)
    )).orElse(activeOrLatest)
    val calculation = storedCalculation.flatMap(row =>
      SeriesAnalysisVocabulary.wireTrigger(row.trigger).map(trigger =>
        SeriesAnalysisCalculation(
          row.status,
          trigger,
          row.requestedAt,
          row.startedAt,
          row.finishedAt,
        )
      )
    )
    val valuesValid =
      row.inputRevision >= 0 && SeriesAnalysisArtifactSupport.supports(
        row.artifactSchemaVersion,
        row.desiredValidationContractId,
      ) &&
        artifact.forall(value =>
          value.gameTitleId == gameTitleId && SeriesAnalysisArtifactSupport.supports(
            value.artifactSchemaVersion,
            row.artifactValidationContractId,
          )
        ) && activeOrLatest.forall(value =>
          AllowedJobStatuses.contains(value.status) && AllowedTriggers.contains(value.trigger)
        ) && pending.forall(value => AllowedTriggers.contains(value.trigger)) &&
        storedCalculation.forall(_ => calculation.nonEmpty)
    val staleInvariantValid = freshness != "stale" || row.pendingWork || calculation.exists(value =>
      value.status == "failed" || value.status == "timed_out"
    )
    Either.cond(
      valuesValid && staleInvariantValid,
      SeriesAnalysisStatus(gameTitleId, desired, freshness, artifact, calculation),
      AppError.AnalysisStateUnavailable(),
    )

end PostgresSeriesAnalysisReadOps
