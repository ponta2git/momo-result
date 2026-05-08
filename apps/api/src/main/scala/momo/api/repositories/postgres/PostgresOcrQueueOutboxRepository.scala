package momo.api.repositories.postgres

import java.time.Instant

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json

import momo.api.domain.ids.OcrJobId
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{
  OcrQueueOutboxDraft, OcrQueueOutboxRecord, OcrQueueOutboxRepository, OcrQueueOutboxStatus,
  OcrQueuePayload,
}

object PostgresOcrQueueOutbox:

  type Row = (String, OcrJobId, Json, Int)

  def insertIntent(draft: OcrQueueOutboxDraft): ConnectionIO[Unit] =
    val payloadJson = OcrQueuePayload.fieldsAsJson(draft.payload)
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
    val (id, jobId, payloadJson, attemptCount) = row
    OcrQueuePayload.fromJson(payloadJson) match
      case Right(payload) => OcrQueueOutboxRecord(id, jobId, payload, attemptCount)
        .pure[ConnectionIO]
      case Left(reason) => MonadThrow[ConnectionIO]
          .raiseError(new IllegalStateException(
            s"ocr_queue_outbox row $id has invalid stream_payload: $reason"
          ))

final class PostgresOcrQueueOutboxRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrQueueOutboxRepository[F]:
  import PostgresOcrQueueOutbox.*

  override def claimDue(
      limit: Int,
      now: Instant,
      claimUntil: Instant,
  ): F[List[OcrQueueOutboxRecord]] =
    sql"""
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
      RETURNING q.id, q.job_id, q.stream_payload, q.attempt_count
    """.query[Row].to[List].flatMap(_.traverse(toRecord)).transact(transactor)

  override def markDelivered(id: String, redisMessageId: String, now: Instant): F[Unit] = sql"""
      UPDATE ocr_queue_outbox
      SET
        status = ${OcrQueueOutboxStatus.Delivered},
        claim_expires_at = NULL,
        delivered_at = $now,
        redis_message_id = $redisMessageId,
        updated_at = $now
      WHERE id = $id
    """.update.run.void.transact(transactor)

  override def releaseForRetry(
      id: String,
      lastError: String,
      nextAttemptAt: Instant,
      now: Instant,
  ): F[Unit] = sql"""
      UPDATE ocr_queue_outbox
      SET
        status = ${OcrQueueOutboxStatus.Pending},
        attempt_count = attempt_count + 1,
        last_error = $lastError,
        claim_expires_at = NULL,
        next_attempt_at = $nextAttemptAt,
        updated_at = $now
      WHERE id = $id
    """.update.run.void.transact(transactor)
