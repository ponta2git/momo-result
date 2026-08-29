package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError

private[postgres] object PostgresSeriesAnalysisAdminOps:
  private val TriggerPriority = SeriesAnalysisVocabulary.TriggersByPriority
  private val AllowedJobStatuses = SeriesAnalysisVocabulary.JobStatuses.toSet
  private val AllowedTriggers = TriggerPriority.toSet
  private val AllowedResultDispositions = SeriesAnalysisVocabulary.ResultDispositions.toSet
  private val AllowedFailureCodes = SeriesAnalysisVocabulary.SafeFailureCodes.toSet

  private final case class GlobalRow(
      runningCount: Int,
      queuedTitleCount: Int,
      oldestQueuedAt: Option[Instant],
      activeCampaignCount: Int,
  )
  private final case class CampaignRow(
      campaignId: String,
      targetCount: Int,
      expandedCount: Int,
      terminalCount: Int,
      failedCount: Int,
      skippedCount: Int,
      acceptedAt: Instant,
  )
  private final case class PendingManualRow(requestCount: Long, oldestRequestedAt: Instant)
  private final case class JobRow(
      jobId: String,
      gameTitleId: GameTitleId,
      gameTitleName: String,
      status: String,
      trigger: String,
      requestedAt: Instant,
      startedAt: Option[Instant],
      finishedAt: Option[Instant],
      elapsedMilliseconds: Option[Long],
      inputRevision: Long,
      algorithmVersion: String,
      attemptCount: Int,
      transientRetryCount: Int,
      leaseRecoveryCount: Int,
      queueWaitMilliseconds: Option[Long],
      resultDisposition: String,
      safeFailureCode: Option[String],
  )
  private final case class JobRequestAuditRow(
      trigger: String,
      requestedByAccountId: Option[AccountId],
      requesterDisplayName: Option[String],
  )

  def overview(
      selectedId: Option[GameTitleId]
  ): ConnectionIO[Either[AppError, SeriesAnalysisAdminOverview]] =
    for
      optionsResult <- PostgresSeriesAnalysisReadOps.options
      global <- globalCio
      latestCampaign <- latestCampaignCio
      jobs <- recentJobsCio
      summaryResults <- jobs.traverse(jobSummaryCio)
      result <- (optionsResult, summaryResults.sequence) match
        case (Left(error), _) => error.asLeft[SeriesAnalysisAdminOverview].pure[ConnectionIO]
        case (_, Left(error)) => error.asLeft[SeriesAnalysisAdminOverview].pure[ConnectionIO]
        case (Right(options), Right(summaries)) =>
          val selected = selectedId.orElse(options.defaultGameTitleId)
          selected match
            case Some(id) if !options.titles.exists(_.gameTitleId == id) =>
              AppError.NotFound("game title", id.value).asLeft[SeriesAnalysisAdminOverview]
                .pure[ConnectionIO]
            case None => SeriesAnalysisAdminOverview(
                options.titles,
                None,
                global.copy(latestActiveCampaign = latestCampaign),
                summaries,
              ).asRight[AppError].pure[ConnectionIO]
            case Some(id) =>
              val option = options.titles.find(_.gameTitleId == id)
              for
                statusResult <- PostgresSeriesAnalysisReadOps.status(id)
                pending <- pendingManualCio(id)
              yield statusResult.map(status =>
                SeriesAnalysisAdminOverview(
                  options.titles,
                  option.map(value =>
                    SeriesAnalysisSelectedTitle(id, value.displayName, status, pending)
                  ),
                  global.copy(latestActiveCampaign = latestCampaign),
                  summaries,
                )
              )
    yield result

  private def globalCio: ConnectionIO[SeriesAnalysisGlobalExecution] = sql"""
    WITH queued AS (
      SELECT game_title_id, requested_at AS queued_at
      FROM series_analysis_jobs WHERE status = 'queued'
      UNION ALL
      SELECT game_title_id, accepted_at
      FROM series_analysis_job_requests
      WHERE status = 'pending' AND assigned_job_id IS NULL
      UNION ALL
      SELECT game_title_id, accepted_at
      FROM series_analysis_campaign_targets
      WHERE status = 'pending'
    ), queued_titles AS (
      SELECT game_title_id, MIN(queued_at) AS queued_at
      FROM queued GROUP BY game_title_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM series_analysis_jobs WHERE status = 'running'),
      COUNT(*)::int,
      MIN(queued_at),
      (SELECT COUNT(*)::int FROM series_analysis_campaigns WHERE status <> 'terminal')
    FROM queued_titles
  """.query[GlobalRow].unique.map(row =>
    SeriesAnalysisGlobalExecution(
      math.min(row.runningCount, 1),
      row.queuedTitleCount,
      row.oldestQueuedAt,
      row.activeCampaignCount,
      None,
    )
  )

  private def latestCampaignCio: ConnectionIO[Option[SeriesAnalysisCampaignSummary]] = sql"""
    SELECT id, target_count, expanded_count, terminal_count,
           failed_count, skipped_count, accepted_at
    FROM series_analysis_campaigns
    WHERE status <> 'terminal'
    ORDER BY accepted_at DESC, id DESC
    LIMIT 1
  """.query[CampaignRow].option.map(_.map(row =>
    SeriesAnalysisCampaignSummary(
      row.campaignId,
      row.targetCount,
      row.expandedCount,
      row.terminalCount,
      row.failedCount,
      row.skippedCount,
      row.acceptedAt,
    )
  ))

  private def recentJobsCio: ConnectionIO[List[JobRow]] = sql"""
    SELECT
      j.id,
      j.game_title_id,
      gt.name,
      j.status,
      j.trigger,
      j.requested_at,
      j.started_at,
      j.finished_at,
      j.elapsed_milliseconds,
      j.input_revision,
      j.algorithm_version,
      j.attempt_count,
      j.transient_retry_count,
      j.lease_recovery_count,
      CASE WHEN j.started_at IS NULL THEN NULL
           ELSE (EXTRACT(EPOCH FROM (j.started_at - j.requested_at)) * 1000)::bigint END,
      j.result_disposition,
      j.safe_failure_code
    FROM series_analysis_jobs j
    JOIN game_titles gt ON gt.id = j.game_title_id
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT 3
  """.query[JobRow].to[List]

  private def jobSummaryCio(
      job: JobRow
  ): ConnectionIO[Either[AppError, SeriesAnalysisJobSummary]] = sql"""
    SELECT
      jr.trigger,
      op.requested_by_account_id,
      account.display_name
    FROM series_analysis_job_requests jr
    LEFT JOIN series_analysis_operation_requests op ON op.id = jr.operation_request_id
    LEFT JOIN momo_login_accounts account ON account.id = op.requested_by_account_id
    WHERE jr.assigned_job_id = ${job.jobId}
    ORDER BY jr.accepted_at, jr.id
  """.query[JobRequestAuditRow].to[List].map { audit =>
    val coalesced = TriggerPriority.filter(trigger =>
      trigger == job.trigger || audit.exists(_.trigger == trigger)
    )
    val manual = audit.filter(_.trigger == "manual")
    val hasSystem = coalesced.exists(_ != "manual")
    val requestedBy =
      if manual.nonEmpty && hasSystem then "mixed"
      else if manual.nonEmpty then "administrator"
      else "system"
    val firstRequester = manual.flatMap(row =>
      row.requestedByAccountId.zip(row.requesterDisplayName).map((accountId, displayName) =>
        SeriesAnalysisRequester(accountId, displayName)
      )
    ).headOption
    val valuesValid =
      AllowedJobStatuses.contains(job.status) &&
        AllowedTriggers.contains(job.trigger) &&
        AllowedResultDispositions.contains(job.resultDisposition) &&
        job.safeFailureCode.forall(AllowedFailureCodes.contains) &&
        audit.forall(row => AllowedTriggers.contains(row.trigger))
    Either.cond(
      valuesValid,
      SeriesAnalysisJobSummary(
        job.jobId,
        job.gameTitleId,
        job.gameTitleName,
        job.status,
        coalesced.headOption.getOrElse(job.trigger),
        coalesced,
        requestedBy,
        manual.size,
        job.requestedAt,
        job.startedAt,
        job.finishedAt,
        job.elapsedMilliseconds,
        job.inputRevision,
        job.algorithmVersion,
        job.attemptCount,
        job.transientRetryCount,
        job.leaseRecoveryCount,
        job.queueWaitMilliseconds,
        job.resultDisposition,
        firstRequester,
        job.safeFailureCode,
      ),
      AppError.AnalysisStateUnavailable(),
    )
  }

  private def pendingManualCio(
      gameTitleId: GameTitleId
  ): ConnectionIO[Option[SeriesAnalysisPendingManualRun]] = sql"""
    SELECT COUNT(*)::bigint, MIN(accepted_at)
    FROM series_analysis_job_requests
    WHERE game_title_id = $gameTitleId
      AND trigger = 'manual'
      AND status <> 'fulfilled'
    HAVING COUNT(*) > 0
  """.query[PendingManualRow].option.map(_.map(row =>
    SeriesAnalysisPendingManualRun(math.toIntExact(row.requestCount), row.oldestRequestedAt)
  ))

end PostgresSeriesAnalysisAdminOps
