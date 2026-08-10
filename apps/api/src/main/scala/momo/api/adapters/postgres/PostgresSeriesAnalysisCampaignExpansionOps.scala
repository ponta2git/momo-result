package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresSeriesAnalysisRequestSupport.{insertOutbox, DesiredRow}
import momo.api.domain.ids.GameTitleId

/**
 * Expands one durable campaign target per transaction.
 *
 * The title state and active job are locked before the target row. This matches the worker's lock
 * order and keeps a large campaign from holding every target/job lock until the whole expansion
 * completes. A crash can therefore leave only `pending` targets, which are safe to retry.
 */
private[postgres] object PostgresSeriesAnalysisCampaignExpansionOps:
  private val TransactionLimitMillis = 10000
  private val LockLimitMillis = 5000

  final case class TargetKey(campaignId: String, gameTitleId: GameTitleId)

  private final case class TargetRow(
      campaignId: String,
      gameTitleId: GameTitleId,
      inputRevision: Long,
      algorithmVersion: String,
      artifactSchemaVersion: Int,
      acceptedAt: Instant,
      operationId: String,
      trigger: String,
  )

  private final case class ActiveJobRow(
      id: String,
      status: String,
      startedAt: Option[Instant],
      attemptId: Option[String],
  )

  private final case class Assignment(
      jobId: Option[String],
      attemptId: Option[String],
      requestStatus: String,
      targetStatus: String,
      enqueueJobId: Option[String],
  )

  private final case class TransactionLimitsRow(statement: String, lock: String)

  def pendingTargets(limit: Int): ConnectionIO[List[TargetKey]] =
    configureTransactionLimits *> sql"""
      SELECT campaign_id, game_title_id
      FROM series_analysis_campaign_targets
      WHERE status = 'pending'
      ORDER BY accepted_at, campaign_id, game_title_id
      LIMIT $limit
    """.query[TargetKey].to[List]

  def expandTarget(key: TargetKey, now: Instant): ConnectionIO[Boolean] =
    for
      _ <- configureTransactionLimits
      desired <- lockDesired(key.gameTitleId)
      active <- desired.traverse(_ => lockActiveJob(key.gameTitleId)).map(_.flatten)
      target <- lockPendingTarget(key)
      expanded <- target match
        case None => false.pure[ConnectionIO]
        case Some(value) => desired match
            case None => skipDeletedTitle(value, now).as(true)
            case Some(current) => materialize(value, current, active, now).as(true)
    yield expanded

  private def configureTransactionLimits: ConnectionIO[Unit] = sql"""
    SELECT set_config('statement_timeout', ${TransactionLimitMillis.toString}, true),
           set_config('lock_timeout', ${LockLimitMillis.toString}, true)
  """.query[TransactionLimitsRow].unique.void

  private def lockDesired(gameTitleId: GameTitleId): ConnectionIO[Option[DesiredRow]] = sql"""
    SELECT input_revision, algorithm_version, artifact_schema_version
    FROM series_analysis_title_states
    WHERE game_title_id = $gameTitleId
    FOR UPDATE
  """.query[DesiredRow].option

  private def lockActiveJob(gameTitleId: GameTitleId): ConnectionIO[Option[ActiveJobRow]] = sql"""
    SELECT id, status, started_at, lease_attempt_id
    FROM series_analysis_jobs
    WHERE game_title_id = $gameTitleId
      AND status IN ('queued', 'running')
    FOR UPDATE
  """.query[ActiveJobRow].option

  private def lockPendingTarget(key: TargetKey): ConnectionIO[Option[TargetRow]] = sql"""
    SELECT t.campaign_id, t.game_title_id, t.input_revision,
           t.algorithm_version, t.artifact_schema_version, t.accepted_at,
           c.operation_request_id, c.trigger
    FROM series_analysis_campaign_targets t
    JOIN series_analysis_campaigns c ON c.id = t.campaign_id
    WHERE t.campaign_id = ${key.campaignId}
      AND t.game_title_id = ${key.gameTitleId}
      AND t.status = 'pending'
    FOR UPDATE OF t
  """.query[TargetRow].option

  private def materialize(
      target: TargetRow,
      desired: DesiredRow,
      active: Option[ActiveJobRow],
      now: Instant,
  ): ConnectionIO[Unit] =
    val requestId = stableId("analysis-request", target)
    val newJobId = stableId("analysis-job", target)
    val outboxId = stableId("analysis-outbox", target)
    for
      assignment <- assign(target, desired, active, newJobId)
      _ <- insertRequest(target, requestId, assignment)
      _ <- sql"""
        UPDATE series_analysis_campaign_targets
        SET status = ${assignment.targetStatus},
            job_request_id = $requestId,
            updated_at = $now
        WHERE campaign_id = ${target.campaignId}
          AND game_title_id = ${target.gameTitleId}
          AND status = 'pending'
      """.update.run.void
      _ <- assignment.enqueueJobId.traverse_(jobId =>
        insertOutbox(
          outboxId,
          jobId,
          s"campaign:${target.campaignId}:${target.gameTitleId.value}",
        )
      )
      _ <- refreshCampaign(target.campaignId, now)
    yield ()

  private def assign(
      target: TargetRow,
      desired: DesiredRow,
      active: Option[ActiveJobRow],
      newJobId: String,
  ): ConnectionIO[Assignment] = active match
    case None =>
      sql"""
        INSERT INTO series_analysis_jobs (
          id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, status, trigger, requested_at, available_at
        ) VALUES (
          $newJobId, ${target.gameTitleId}, ${desired.inputRevision},
          ${desired.algorithmVersion}, ${desired.artifactSchemaVersion},
          'queued', ${target.trigger}, ${target.acceptedAt}, ${target.acceptedAt}
        )
      """.update.run.as(Assignment(
        Some(newJobId),
        None,
        "pending",
        "expanded",
        Some(newJobId),
      ))
    case Some(job) if job.status == "queued" =>
      sql"""
        UPDATE series_analysis_jobs
        SET input_revision = ${desired.inputRevision},
            algorithm_version = ${desired.algorithmVersion},
            artifact_schema_version = ${desired.artifactSchemaVersion},
            updated_at = now()
        WHERE id = ${job.id} AND status = 'queued'
      """.update.run.as(Assignment(
        Some(job.id),
        None,
        "pending",
        "expanded",
        Some(job.id),
      ))
    case Some(job) if canJoinRunning(job, target.acceptedAt) =>
      Assignment(
        Some(job.id),
        job.attemptId,
        "assigned",
        "running",
        None,
      ).pure[ConnectionIO]
    case Some(_) =>
      sql"""
        UPDATE series_analysis_title_states
        SET pending_work = true,
            pending_forced_run_count = pending_forced_run_count + 1,
            updated_at = now()
        WHERE game_title_id = ${target.gameTitleId}
      """.update.run.as(Assignment(None, None, "pending", "expanded", None))

  private def canJoinRunning(job: ActiveJobRow, acceptedAt: Instant): Boolean =
    job.status == "running" && job.attemptId.nonEmpty && job.startedAt.exists(!_.isBefore(acceptedAt))

  private def insertRequest(
      target: TargetRow,
      requestId: String,
      assignment: Assignment,
  ): ConnectionIO[Unit] = sql"""
    INSERT INTO series_analysis_job_requests (
      id, game_title_id, operation_request_id, campaign_id,
      input_revision, algorithm_version, artifact_schema_version,
      trigger, force_run, status, assigned_job_id, assigned_attempt_id, accepted_at
    ) VALUES (
      $requestId, ${target.gameTitleId}, ${target.operationId}, ${target.campaignId},
      ${target.inputRevision}, ${target.algorithmVersion}, ${target.artifactSchemaVersion},
      ${target.trigger}, true, ${assignment.requestStatus}, ${assignment.jobId},
      ${assignment.attemptId}, ${target.acceptedAt}
    )
  """.update.run.void

  private def skipDeletedTitle(target: TargetRow, now: Instant): ConnectionIO[Unit] =
    sql"""
      UPDATE series_analysis_campaign_targets
      SET status = 'skipped_title_deleted', updated_at = $now
      WHERE campaign_id = ${target.campaignId}
        AND game_title_id = ${target.gameTitleId}
        AND status = 'pending'
    """.update.run.void *> refreshCampaign(target.campaignId, now)

  def refreshCampaign(campaignId: String, now: Instant): ConnectionIO[Unit] =
    for
      _ <- sql"""
        WITH counts AS (
          SELECT
            COUNT(*) FILTER (WHERE status <> 'pending')::int AS expanded_count,
            COUNT(*) FILTER (
              WHERE status IN ('succeeded', 'failed', 'skipped_title_deleted')
            )::int AS terminal_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE status = 'skipped_title_deleted')::int AS skipped_count
          FROM series_analysis_campaign_targets
          WHERE campaign_id = $campaignId
        )
        UPDATE series_analysis_campaigns c
        SET expanded_count = counts.expanded_count,
            terminal_count = counts.terminal_count,
            failed_count = counts.failed_count,
            skipped_count = counts.skipped_count,
            status = CASE
              WHEN counts.terminal_count = c.target_count THEN 'terminal'
              WHEN counts.expanded_count = c.target_count THEN 'running'
              ELSE 'expanding'
            END,
            finished_at = CASE
              WHEN counts.terminal_count = c.target_count THEN COALESCE(c.finished_at, $now)
              ELSE NULL
            END
        FROM counts
        WHERE c.id = $campaignId
      """.update.run
      _ <- sql"""
        UPDATE series_analysis_operation_requests o
        SET status = CASE WHEN c.status = 'terminal' THEN 'terminal' ELSE 'running' END,
            finished_at = CASE
              WHEN c.status = 'terminal' THEN COALESCE(o.finished_at, c.finished_at, $now)
              ELSE NULL
            END
        FROM series_analysis_campaigns c
        WHERE c.id = $campaignId
          AND o.id = c.operation_request_id
      """.update.run
    yield ()

  private def stableId(prefix: String, target: TargetRow): String =
    val source = s"$prefix\u0000${target.campaignId}\u0000${target.gameTitleId.value}"
    val digest = MessageDigest.getInstance("SHA-256").digest(
      source.getBytes(StandardCharsets.UTF_8)
    )
    s"$prefix-${digest.take(16).map(value => f"${value & 0xff}%02x").mkString}"

end PostgresSeriesAnalysisCampaignExpansionOps
