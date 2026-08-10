package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{AccountId, GameTitleId}

private[postgres] object PostgresSeriesAnalysisRequestSupport:
  final case class OperationRow(id: String, acceptedAt: Instant, targetCount: Int)
  final case class DesiredRow(
      inputRevision: Long,
      algorithmVersion: String,
      artifactSchemaVersion: Int,
  )
  final case class ActiveJobRow(id: String, status: String)

  def existingOperation(
      requestedBy: AccountId,
      endpoint: String,
      idempotencyKeyHash: String,
  ): ConnectionIO[Option[OperationRow]] = sql"""
    SELECT id, accepted_at, target_count
    FROM series_analysis_operation_requests
    WHERE requested_by_account_id = $requestedBy
      AND endpoint = $endpoint
      AND idempotency_key_hash = $idempotencyKeyHash
  """.query[OperationRow].option

  def insertManualJob(
      jobId: String,
      gameTitleId: GameTitleId,
      version: DesiredRow,
      acceptedAt: Instant,
  ): ConnectionIO[Unit] = sql"""
    INSERT INTO series_analysis_jobs (
      id, game_title_id, input_revision, algorithm_version,
      artifact_schema_version, status, trigger, requested_at, available_at
    ) VALUES (
      $jobId, $gameTitleId, ${version.inputRevision}, ${version.algorithmVersion},
      ${version.artifactSchemaVersion}, 'queued', 'manual', $acceptedAt, $acceptedAt
    )
  """.update.run.void

  def insertOutbox(
      outboxId: String,
      jobId: String,
      dedupeKey: String,
  ): ConnectionIO[Unit] = sql"""
    INSERT INTO series_analysis_queue_outbox (id, job_id, dedupe_key)
    VALUES ($outboxId, $jobId, $dedupeKey)
    ON CONFLICT (dedupe_key) DO NOTHING
  """.update.run.void

end PostgresSeriesAnalysisRequestSupport
