package momo.api.adapters.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.contracts.ocrworker.OcrWorkerJobMessage
import momo.api.domain.ids.OcrJobId
import momo.api.repositories.{
  OcrQueueBacklogSnapshot,
  OcrQueueOutboxDraft,
  OcrQueueOutboxRecord,
  OcrQueueOutboxRepository,
  OcrQueueOutboxStatus
}

object PostgresOcrQueueOutbox:

  final case class Row(
      id: String,
      jobId: OcrJobId,
      payloadJson: Json,
      attemptCount: Int,
      claimExpiresAt: Instant,
  )

  def insertIntent(draft: OcrQueueOutboxDraft): ConnectionIO[Unit] =
    val payloadJson = OcrWorkerJobMessage.fieldsAsJson(
      OcrWorkerJobMessage.fromEnqueueRequest(draft.enqueueRequest)
    )
    sql"""
      INSERT INTO ocr_queue_outbox (
        id, job_id, dedupe_key, stream_payload,
        status, attempt_count, next_attempt_at,
        created_at, updated_at
      ) VALUES (
        ${draft.id}, ${draft.jobId}, ${draft.dedupeKey}, $payloadJson,
        ${OcrQueueOutboxStatus.Pending}, 0, ${draft.createdAt},
        ${draft.createdAt}, ${draft.createdAt}
      )
    """.update.run.void

  def toRecord(row: Row): ConnectionIO[OcrQueueOutboxRecord] =
    OcrWorkerJobMessage.fromJson(row.payloadJson) match
      case Right(message) =>
        OcrQueueOutboxRecord(
          row.id,
          row.jobId,
          message.toEnqueueRequest,
          row.attemptCount,
          row.claimExpiresAt,
        ).pure[ConnectionIO]
      case Left(reason) => MonadThrow[ConnectionIO].raiseError(
          PostgresDataIntegrityException.invalidPayload(
            "ocr_queue_outbox",
            row.id,
            "stream_payload",
            reason,
          )
        )

  final case class BacklogSnapshotRow(
      pendingCount: Long,
      inFlightCount: Long,
      expiredInFlightCount: Long,
      duePendingCount: Long,
      oldestDueNextAttemptAt: Option[Instant],
  ):
    def toSnapshot: OcrQueueBacklogSnapshot = OcrQueueBacklogSnapshot(
      pendingCount = pendingCount,
      inFlightCount = inFlightCount,
      expiredInFlightCount = expiredInFlightCount,
      duePendingCount = duePendingCount,
      oldestDueNextAttemptAt = oldestDueNextAttemptAt,
    )

final class PostgresOcrQueueOutboxRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrQueueOutboxRepository[F]:
  import PostgresOcrQueueOutbox.*

  override def claimById(
      id: String,
      now: Instant,
      claimUntil: Instant,
  ): F[Option[OcrQueueOutboxRecord]] = sql"""
      WITH candidate AS (
        SELECT id
        FROM ocr_queue_outbox
        WHERE id = $id
          AND status = ${OcrQueueOutboxStatus.Pending}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ocr_queue_outbox q
      SET
        status = ${OcrQueueOutboxStatus.InFlight},
        claim_expires_at = $claimUntil,
        updated_at = $now
      FROM candidate
      WHERE q.id = candidate.id
      RETURNING q.id, q.job_id, q.stream_payload, q.attempt_count, q.claim_expires_at
    """.query[Row].option.flatMap(_.traverse(toRecord)).transact(transactor)

  override def claimDue(
      limit: Int,
      now: Instant,
      claimUntil: Instant,
  ): F[List[OcrQueueOutboxRecord]] = sql"""
      WITH candidate AS (
        SELECT id
        FROM ocr_queue_outbox
        WHERE
          (status = ${OcrQueueOutboxStatus.Pending} AND next_attempt_at <= $now)
          OR (status = ${OcrQueueOutboxStatus.InFlight} AND claim_expires_at < $now)
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        LIMIT $limit
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ocr_queue_outbox q
      SET
        status = ${OcrQueueOutboxStatus.InFlight},
        claim_expires_at = $claimUntil,
        updated_at = $now
      FROM candidate
      WHERE q.id = candidate.id
      RETURNING q.id, q.job_id, q.stream_payload, q.attempt_count, q.claim_expires_at
    """.query[Row].to[List].flatMap(_.traverse(toRecord)).transact(transactor)

  override def backlogSnapshot(now: Instant): F[OcrQueueBacklogSnapshot] = sql"""
      SELECT
        COUNT(*) FILTER (WHERE status = ${OcrQueueOutboxStatus.Pending}) AS pending_count,
        COUNT(*) FILTER (WHERE status = ${OcrQueueOutboxStatus.InFlight}) AS in_flight_count,
        COUNT(*) FILTER (
          WHERE status = ${OcrQueueOutboxStatus.InFlight}
            AND claim_expires_at < $now
        ) AS expired_in_flight_count,
        COUNT(*) FILTER (
          WHERE status = ${OcrQueueOutboxStatus.Pending}
            AND next_attempt_at <= $now
        ) AS due_pending_count,
        MIN(next_attempt_at) FILTER (
          WHERE status = ${OcrQueueOutboxStatus.Pending}
            AND next_attempt_at <= $now
        ) AS oldest_due_next_attempt_at
      FROM ocr_queue_outbox
      WHERE status = ${OcrQueueOutboxStatus.Pending}
         OR status = ${OcrQueueOutboxStatus.InFlight}
    """.query[BacklogSnapshotRow].unique.map(_.toSnapshot).transact(transactor)

  override def markDelivered(
      id: String,
      claimExpiresAt: Instant,
      redisMessageId: String,
      now: Instant,
  ): F[Boolean] = sql"""
      UPDATE ocr_queue_outbox
      SET
        status = ${OcrQueueOutboxStatus.Delivered},
        claim_expires_at = NULL,
        delivered_at = $now,
        redis_message_id = $redisMessageId,
        updated_at = $now
      WHERE id = $id
        AND status = ${OcrQueueOutboxStatus.InFlight}
        AND claim_expires_at = $claimExpiresAt
    """.update.run.map(_ == 1).transact(transactor)

  override def releaseForRetry(
      id: String,
      claimExpiresAt: Instant,
      lastError: String,
      nextAttemptAt: Instant,
      now: Instant,
  ): F[Boolean] = sql"""
      UPDATE ocr_queue_outbox
      SET
        status = ${OcrQueueOutboxStatus.Pending},
        attempt_count = attempt_count + 1,
        last_error = $lastError,
        claim_expires_at = NULL,
        next_attempt_at = $nextAttemptAt,
        updated_at = $now
      WHERE id = $id
        AND status = ${OcrQueueOutboxStatus.InFlight}
        AND claim_expires_at = $claimExpiresAt
    """.update.run.map(_ == 1).transact(transactor)
