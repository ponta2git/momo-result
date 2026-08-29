package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.repositories.{SeriesAnalysisCleanupCounts, SeriesAnalysisHistoryMaintenance}

final class PostgresSeriesAnalysisHistoryMaintenance[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends SeriesAnalysisHistoryMaintenance[F]:
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
