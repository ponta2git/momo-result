package momo.api.adapters.postgres

import java.time.Instant

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
      SELECT id
      FROM series_analysis_queue_outbox
      WHERE (status = 'pending' AND next_attempt_at <= $now)
         OR (status = 'in_flight' AND claim_expires_at < $now)
      ORDER BY next_attempt_at, created_at, id
      LIMIT $limit
      FOR UPDATE SKIP LOCKED
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
      id: String,
      claimExpiresAt: Instant,
      nextAttemptAt: Instant,
      safeErrorClass: String,
      now: Instant,
  ): F[Boolean] = (for
    updated <- sql"""
      UPDATE series_analysis_queue_outbox
      SET status = CASE WHEN attempt_count + 1 >= 3 THEN 'failed' ELSE 'pending' END,
          attempt_count = attempt_count + 1,
          claim_expires_at = NULL,
          next_attempt_at = $nextAttemptAt,
          last_error = $safeErrorClass,
          updated_at = $now
      WHERE id = $id
        AND status = 'in_flight'
        AND claim_expires_at = $claimExpiresAt
      RETURNING job_id, status
    """.query[DeliveryFailureRow].option
    _ <- updated match
      case Some(row) if row.status == "failed" => failUndeliverableJob(row.jobId, now)
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
      FOR UPDATE SKIP LOCKED
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

  private def failUndeliverableJob(jobId: String, now: Instant): ConnectionIO[Unit] =
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
            WHERE q.job_id = j.id AND q.status IN ('pending', 'in_flight', 'delivered')
          )
        RETURNING game_title_id
      """.query[String].option
      _ <- failed.traverse_(gameTitleId => closeUndeliverableRequests(jobId, gameTitleId, now))
    yield ()

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
