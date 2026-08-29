package momo.api.adapters.postgres

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresSeriesAnalysisCampaignExpansionOps.TargetKey
import momo.api.repositories.{
  SeriesAnalysisCleanupCounts,
  SeriesAnalysisQueueOutboxRecord,
  SeriesAnalysisQueueOutboxRepository
}

final class PostgresSeriesAnalysisQueueOutboxRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends SeriesAnalysisQueueOutboxRepository[F]:
  private val ExecutionSlotKey = "shared-heavy-work"
  private val QueuePublishErrorClass = "redis_operation"
  private final case class DeliveryFailureRow(jobId: String, status: String)

  override def expandPendingCampaignTargets(now: Instant, limit: Int): F[Int] =
    if limit <= 0 then 0.pure[F]
    else
      for
        targets <- PostgresSeriesAnalysisCampaignExpansionOps.pendingTargets(limit)
          .transact(transactor)
        attempts <- targets.traverse(target => expandTarget(target, now).attempt)
        _ <- attempts.collectFirst { case Left(error) => error }.traverse_(error =>
          MonadCancelThrow[F].raiseError[Unit](error)
        )
      yield attempts.collect { case Right(true) => () }.size

  override def claimDue(
      limit: Int,
      now: Instant,
      claimUntil: Instant,
  ): F[List[SeriesAnalysisQueueOutboxRecord]] = sql"""
    WITH candidate AS (
      SELECT q.id
      FROM series_analysis_queue_outbox q
      JOIN series_analysis_jobs j ON j.id = q.job_id
      WHERE j.available_at <= $now
        AND (
          (q.status = 'pending' AND q.next_attempt_at <= $now)
          OR (q.status = 'in_flight' AND q.claim_expires_at <= $now)
        )
      ORDER BY q.next_attempt_at, q.created_at, q.id
      LIMIT $limit
      FOR UPDATE OF q SKIP LOCKED
    )
    UPDATE series_analysis_queue_outbox q
    SET status = 'in_flight',
        claim_expires_at = $claimUntil,
        last_attempt_at = $now,
        updated_at = $now
    FROM candidate
    WHERE q.id = candidate.id
    RETURNING q.id, q.job_id, q.attempt_count, q.claim_expires_at
  """.query[SeriesAnalysisQueueOutboxRecord].to[List].transact(transactor)

  override def markDelivered(
      id: String,
      claimExpiresAt: Instant,
      redisMessageId: String,
      now: Instant,
  ): F[Boolean] = sql"""
    UPDATE series_analysis_queue_outbox
    SET status = 'delivered',
        claim_expires_at = NULL,
        redis_message_id = $redisMessageId,
        delivered_at = $now,
        last_error = NULL,
        updated_at = $now
    WHERE id = $id
      AND status = 'in_flight'
      AND claim_expires_at = $claimExpiresAt
  """.update.run.map(_ == 1).transact(transactor)

  override def releaseForRetry(
      claim: SeriesAnalysisQueueOutboxRecord,
      nextAttemptAt: Instant,
      redeliverBefore: Instant,
      now: Instant,
  ): F[Boolean] = (for
    boundaryExists <- if claim.exhaustsDeliveryAttempts then lockTerminalBoundary(claim)
    else lockRetryJob(claim.jobId)
    updated <- if !boundaryExists then Option.empty[DeliveryFailureRow].pure[ConnectionIO]
    else
      sql"""
        UPDATE series_analysis_queue_outbox
        SET status = CASE WHEN attempt_count + 1 >= 3 THEN 'failed' ELSE 'pending' END,
            attempt_count = attempt_count + 1,
            claim_expires_at = NULL,
            next_attempt_at = GREATEST(
              $nextAttemptAt,
              (SELECT available_at FROM series_analysis_jobs WHERE id = ${claim.jobId})
            ),
            last_error = $QueuePublishErrorClass,
            updated_at = $now
        WHERE id = ${claim.id}
          AND job_id = ${claim.jobId}
          AND status = 'in_flight'
          AND attempt_count = ${claim.attemptCount}
          AND claim_expires_at = ${claim.claimExpiresAt}
        RETURNING job_id, status
      """.query[DeliveryFailureRow].option
    _ <- updated match
      case Some(row) if row.status == "failed" =>
        failUndeliverableJob(row.jobId, redeliverBefore, now)
      case _ => ().pure[ConnectionIO]
  yield updated.nonEmpty).transact(transactor)

  override def reconcileQueued(
      now: Instant,
      redeliverBefore: Instant,
      limit: Int,
  ): F[Int] = sql"""
    WITH candidates AS (
      SELECT j.id, j.input_revision
      FROM series_analysis_jobs j
      WHERE j.status = 'queued'
        AND j.available_at <= $now
        AND j.lease_owner IS NULL
        AND j.lease_attempt_id IS NULL
        AND j.lease_fencing_token IS NULL
        AND j.lease_expires_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM series_analysis_queue_outbox q
          WHERE q.job_id = j.id
            AND (
              q.status IN ('pending', 'in_flight')
              OR (q.status = 'delivered' AND q.delivered_at >= $redeliverBefore)
            )
        )
      ORDER BY j.available_at, j.requested_at, j.id
      LIMIT $limit
      FOR UPDATE OF j SKIP LOCKED
    )
    INSERT INTO series_analysis_queue_outbox (id, job_id, dedupe_key, next_attempt_at)
    SELECT
      'analysis-reconcile-' || md5(id || ':' || input_revision::text || ':' || $now::text),
      id,
      'reconcile:' || id || ':' || input_revision::text || ':' || $now::text,
      $now
    FROM candidates
    ON CONFLICT (dedupe_key) DO NOTHING
  """.update.run.transact(transactor)

  override def nextWakeAt(
      _now: Instant,
      redeliveryAfter: FiniteDuration,
  ): F[Option[Instant]] =
    val redeliveryMillis = redeliveryAfter.toMillis
    sql"""
      SELECT MIN(wake_at)
      FROM (
        SELECT GREATEST(q.next_attempt_at, j.available_at) AS wake_at
        FROM series_analysis_queue_outbox q
        JOIN series_analysis_jobs j ON j.id = q.job_id
        WHERE q.status = 'pending'
        UNION ALL
        SELECT GREATEST(q.claim_expires_at, j.available_at) AS wake_at
        FROM series_analysis_queue_outbox q
        JOIN series_analysis_jobs j ON j.id = q.job_id
        WHERE q.status = 'in_flight'
        UNION ALL
        SELECT GREATEST(
          j.available_at,
          COALESCE(
            MAX(q.delivered_at) FILTER (WHERE q.status = 'delivered')
              + ($redeliveryMillis * INTERVAL '1 millisecond'),
            j.available_at
          )
        ) AS wake_at
        FROM series_analysis_jobs j
        LEFT JOIN series_analysis_queue_outbox q ON q.job_id = j.id
        WHERE j.status = 'queued'
          AND j.lease_owner IS NULL
          AND j.lease_attempt_id IS NULL
          AND j.lease_fencing_token IS NULL
          AND j.lease_expires_at IS NULL
        GROUP BY j.id
        HAVING COUNT(q.id) FILTER (WHERE q.status IN ('pending', 'in_flight')) = 0
      ) deadlines
      WHERE wake_at IS NOT NULL
    """.query[Option[Instant]].unique.transact(transactor)

  override def cleanupHistory(
      terminalBefore: Instant,
      stagingBefore: Instant,
      limitPerTable: Int,
  ): F[SeriesAnalysisCleanupCounts] = (for
    operations <- sql"""
      DELETE FROM series_analysis_operation_requests
      WHERE id IN (
        SELECT id FROM series_analysis_operation_requests
        WHERE status = 'terminal' AND finished_at < $terminalBefore
        ORDER BY finished_at, id
        LIMIT $limitPerTable
        FOR UPDATE SKIP LOCKED
      )
    """.update.run
    requests <- sql"""
      DELETE FROM series_analysis_job_requests
      WHERE id IN (
        SELECT id FROM series_analysis_job_requests
        WHERE status = 'fulfilled'
          AND fulfilled_at < $terminalBefore
          AND operation_request_id IS NULL
          AND campaign_id IS NULL
        ORDER BY fulfilled_at, id
        LIMIT $limitPerTable
        FOR UPDATE SKIP LOCKED
      )
    """.update.run
    jobs <- sql"""
      DELETE FROM series_analysis_jobs
      WHERE id IN (
        SELECT id FROM series_analysis_jobs
        WHERE status IN ('succeeded', 'failed', 'timed_out')
          AND finished_at < $terminalBefore
        ORDER BY finished_at, id
        LIMIT $limitPerTable
        FOR UPDATE SKIP LOCKED
      )
    """.update.run
    stagingArtifacts <- sql"""
      DELETE FROM series_analysis_artifacts
      WHERE id IN (
        SELECT a.id FROM series_analysis_artifacts a
        WHERE a.status = 'staging' AND a.created_at < $stagingBefore
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_title_states s
            WHERE a.id IN (s.current_artifact_id, s.previous_artifact_id)
          )
        ORDER BY a.created_at, a.id
        LIMIT $limitPerTable
        FOR UPDATE SKIP LOCKED
      )
    """.update.run
    obsoleteArtifacts <- sql"""
      DELETE FROM series_analysis_artifacts
      WHERE id IN (
        SELECT a.id FROM series_analysis_artifacts a
        WHERE a.status = 'published' AND a.published_at < $terminalBefore
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_title_states s
            WHERE a.id IN (s.current_artifact_id, s.previous_artifact_id)
          )
        ORDER BY a.published_at, a.id
        LIMIT $limitPerTable
        FOR UPDATE SKIP LOCKED
      )
    """.update.run
  yield SeriesAnalysisCleanupCounts(
    operations,
    requests,
    jobs,
    stagingArtifacts,
    obsoleteArtifacts,
  )).transact(transactor)

  private def failUndeliverableJob(
      jobId: String,
      redeliverBefore: Instant,
      now: Instant,
  ): ConnectionIO[Unit] =
    for
      failed <- sql"""
        UPDATE series_analysis_jobs j
        SET status = 'failed',
            finished_at = $now,
            safe_failure_code = 'dependency_retry_exhausted',
            updated_at = $now
        WHERE j.id = $jobId
          AND j.status = 'queued'
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_queue_outbox q
            WHERE q.job_id = j.id
              AND (
                q.status IN ('pending', 'in_flight')
                OR (q.status = 'delivered' AND q.delivered_at >= $redeliverBefore)
              )
          )
        RETURNING game_title_id
      """.query[String].option
      _ <- failed.traverse_(gameTitleId => closeUndeliverableRequests(jobId, gameTitleId, now))
    yield ()

  private def lockRetryJob(jobId: String): ConnectionIO[Boolean] = sql"""
    SELECT id
    FROM series_analysis_jobs
    WHERE id = $jobId
    FOR UPDATE
  """.query[String].option.map(_.nonEmpty)

  private def lockTerminalBoundary(
      claim: SeriesAnalysisQueueOutboxRecord
  ): ConnectionIO[Boolean] = sql"""
    SELECT game_title_id
    FROM series_analysis_jobs
    WHERE id = ${claim.jobId}
  """.query[String].option.flatMap {
    case None => false.pure[ConnectionIO]
    case Some(gameTitleId) =>
      for
        _ <- sql"""
          SELECT slot_key
          FROM worker_execution_slots
          WHERE slot_key = $ExecutionSlotKey
          FOR UPDATE
        """.query[String].unique
        titleExists <- sql"""
          SELECT game_title_id
          FROM series_analysis_title_states
          WHERE game_title_id = $gameTitleId
          FOR UPDATE
        """.query[String].option.map(_.nonEmpty)
        jobExists <- sql"""
          SELECT id
          FROM series_analysis_jobs
          WHERE id = ${claim.jobId} AND game_title_id = $gameTitleId
          FOR UPDATE
        """.query[String].option.map(_.nonEmpty)
        _ <- if jobExists && !titleExists then
          new IllegalStateException(
            s"Series analysis job ${claim.jobId} has no title state"
          ).raiseError[ConnectionIO, Unit]
        else ().pure[ConnectionIO]
      yield jobExists
  }

  private def closeUndeliverableRequests(
      jobId: String,
      gameTitleId: String,
      now: Instant,
  ): ConnectionIO[Unit] =
    for
      _ <- sql"""
        UPDATE series_analysis_title_states
        SET pending_work = true,
            last_failure_code = 'dependency_retry_exhausted',
            last_failure_at = $now,
            updated_at = $now
        WHERE game_title_id = $gameTitleId
      """.update.run
      _ <- sql"""
        UPDATE series_analysis_job_requests
        SET status = 'fulfilled', fulfilled_at = $now
        WHERE assigned_job_id = $jobId AND status <> 'fulfilled'
      """.update.run
      affectedCampaigns <- sql"""
        UPDATE series_analysis_campaign_targets t
        SET status = 'failed', updated_at = $now
        FROM series_analysis_job_requests r
        WHERE t.job_request_id = r.id
          AND r.assigned_job_id = $jobId
          AND t.status NOT IN ('succeeded', 'failed', 'skipped_title_deleted')
        RETURNING t.campaign_id
      """.query[String].to[List]
      _ <- affectedCampaigns.distinct.traverse_(campaignId =>
        PostgresSeriesAnalysisCampaignExpansionOps.refreshCampaign(campaignId, now)
      )
      _ <- sql"""
        UPDATE series_analysis_operation_requests o
        SET status = 'terminal', finished_at = COALESCE(o.finished_at, $now)
        WHERE o.scope = 'title'
          AND o.status <> 'terminal'
          AND EXISTS (
            SELECT 1 FROM series_analysis_job_requests changed
            WHERE changed.operation_request_id = o.id
              AND changed.assigned_job_id = $jobId
          )
          AND NOT EXISTS (
            SELECT 1 FROM series_analysis_job_requests pending
            WHERE pending.operation_request_id = o.id
              AND pending.status <> 'fulfilled'
          )
      """.update.run
    yield ()

  private def expandTarget(target: TargetKey, now: Instant): F[Boolean] =
    PostgresSeriesAnalysisCampaignExpansionOps.expandTarget(target, now).transact(transactor)
