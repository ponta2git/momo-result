package momo.api.adapters.postgres

import java.time.Instant
import java.util.UUID

import scala.concurrent.duration.FiniteDuration

import cats.MonadThrow
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.contracts.ocrworker.OcrWorkerJobMessageV2
import momo.api.domain.ids.OcrJobId
import momo.api.domain.{FailureCode, OcrJobStatus}
import momo.api.repositories.{
  InvalidOcrQueueOutboxClaim,
  OcrQueueBacklogSnapshot,
  OcrQueueOutboxClaim,
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
      outboxSchemaVersion: Short,
      jobSchemaVersion: Short,
      jobStatus: String,
      jobAttemptCount: Int,
      attemptCount: Int,
      claimToken: UUID,
      claimExpiresAt: Instant,
  )

  def insertIntent(draft: OcrQueueOutboxDraft): ConnectionIO[Unit] =
    OcrWorkerJobMessageV2.fromEnqueueRequest(draft.enqueueRequest) match
      case Left(reason) => MonadThrow[ConnectionIO].raiseError(
          PostgresDataIntegrityException.invalidPayload(
            "ocr_queue_outbox",
            draft.id,
            "stream_payload",
            reason,
          )
        )
      case Right(message) =>
        val payloadJson = OcrWorkerJobMessageV2.fieldsAsJson(message)
        sql"""
          INSERT INTO ocr_queue_outbox (
            id, job_id, dedupe_key, stream_payload, schema_version,
            status, attempt_count, next_attempt_at,
            created_at, updated_at
          ) VALUES (
            ${draft.id}, ${draft.jobId}, ${draft.dedupeKey}, $payloadJson, 2,
            ${OcrQueueOutboxStatus.Pending}, 0, ${draft.createdAt},
            ${draft.createdAt}, ${draft.createdAt}
          )
        """.update.run.void

  def toClaim(row: Row): OcrQueueOutboxClaim =
    val invalid = OcrQueueOutboxClaim.Invalid(
      InvalidOcrQueueOutboxClaim(row.id, row.jobId, row.claimToken)
    )
    if row.outboxSchemaVersion != 2 || row.jobSchemaVersion != 2 ||
      row.jobStatus != OcrJobStatus.Queued.wire || row.jobAttemptCount != 0 ||
      row.id != OcrQueueOutboxDraft.idForJob(row.jobId)
    then invalid
    else
      OcrWorkerJobMessageV2.fromJson(row.payloadJson) match
        case Right(message)
            if OcrWorkerJobMessageV2.fieldsAsJson(message).equals(row.payloadJson) =>
          message.toEnqueueRequest match
            case Right(request) if request.jobId == row.jobId =>
              OcrQueueOutboxClaim.Publish(
                OcrQueueOutboxRecord(
                  row.id,
                  row.jobId,
                  request,
                  row.attemptCount,
                  row.claimToken,
                  row.claimExpiresAt,
                )
              )
            case _ => invalid
        case _ => invalid

  final case class BacklogSnapshotRow(
      pendingCount: Long,
      inFlightCount: Long,
      expiredInFlightCount: Long,
      duePendingCount: Long,
      oldestDueNextAttemptAt: Option[Instant],
      recoverableInvalidCount: Long,
  ):
    def toSnapshot: OcrQueueBacklogSnapshot = OcrQueueBacklogSnapshot(
      pendingCount = pendingCount,
      inFlightCount = inFlightCount,
      expiredInFlightCount = expiredInFlightCount,
      duePendingCount = duePendingCount,
      oldestDueNextAttemptAt = oldestDueNextAttemptAt,
      recoverableInvalidCount = recoverableInvalidCount,
    )

final class PostgresOcrQueueOutboxRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrQueueOutboxRepository[F]:
  import PostgresOcrQueueOutbox.*

  private val invalidContractLastError = "invalid_persisted_contract"
  private val invalidContractMessage = "The OCR queue delivery failed its persisted contract."
  private val invalidContractUserAction = "運用担当者に連絡してください。"

  override def claimDue(
      limit: Int,
      now: Instant,
      claimUntil: Instant,
  ): F[List[OcrQueueOutboxClaim]] = sql"""
      WITH candidate AS (
        SELECT q.id,
               j.queue_schema_version AS job_schema_version,
               j.status AS job_status,
               j.attempt_count AS job_attempt_count
        FROM ocr_queue_outbox q
        JOIN ocr_jobs j ON j.id = q.job_id
        WHERE
          (q.status = ${OcrQueueOutboxStatus.Pending} AND q.next_attempt_at <= $now)
          OR (q.status = ${OcrQueueOutboxStatus.InFlight} AND q.claim_expires_at <= $now)
          OR (
            q.status = ${OcrQueueOutboxStatus.Delivered}
            AND j.status = ${OcrJobStatus.Queued}
            AND (q.schema_version <> 2 OR j.queue_schema_version <> 2)
          )
        ORDER BY q.next_attempt_at ASC, q.created_at ASC, q.id ASC
        LIMIT $limit
        FOR UPDATE OF q SKIP LOCKED
      )
      UPDATE ocr_queue_outbox q
      SET
        status = ${OcrQueueOutboxStatus.InFlight},
        claim_token = gen_random_uuid(),
        claim_expires_at = $claimUntil,
        updated_at = $now
      FROM candidate
      WHERE q.id = candidate.id
      RETURNING q.id, q.job_id, q.stream_payload, q.schema_version,
                candidate.job_schema_version, candidate.job_status,
                candidate.job_attempt_count, q.attempt_count,
                q.claim_token, q.claim_expires_at
    """.query[Row].to[List].map(_.map(toClaim)).transact(transactor)

  override def failInvalidClaim(
      claim: InvalidOcrQueueOutboxClaim,
      now: Instant,
  ): F[Boolean] = (for
    _ <- PostgresMatchDraftStatusSync.lockForJob(claim.jobId)
    jobState <- sql"""
      SELECT status, attempt_count, queue_schema_version
      FROM ocr_jobs
      WHERE id = ${claim.jobId}
      FOR UPDATE
    """.query[(String, Int, Short)].option
    outboxUpdated <- sql"""
      UPDATE ocr_queue_outbox
      SET
        status = ${OcrQueueOutboxStatus.Failed},
        last_error = $invalidContractLastError,
        claim_token = NULL,
        claim_expires_at = NULL,
        updated_at = $now
      WHERE id = ${claim.id}
        AND job_id = ${claim.jobId}
        AND status = ${OcrQueueOutboxStatus.InFlight}
        AND claim_token = ${claim.claimToken}
    """.update.run
    jobUpdated <-
      if outboxUpdated == 1 && jobState.exists {
          case (status, attemptCount, schemaVersion) if status == OcrJobStatus.Queued.wire =>
            schemaVersion != 2 || attemptCount == 0
          case _ => false
        }
      then
        sql"""
        UPDATE ocr_jobs
        SET
          status = ${OcrJobStatus.Failed},
          failure_code = ${FailureCode.QueueFailure},
          failure_message = $invalidContractMessage,
          failure_retryable = false,
          failure_user_action = $invalidContractUserAction,
          finished_at = $now,
          duration_ms = 0,
          updated_at = $now
        WHERE id = ${claim.jobId}
          AND status = ${OcrJobStatus.Queued}
          AND (queue_schema_version <> 2 OR attempt_count = 0)
      """.update.run
      else 0.pure[ConnectionIO]
    _ <-
      if jobUpdated == 1 then PostgresMatchDraftStatusSync.recomputeForJob(claim.jobId, now)
      else ().pure[ConnectionIO]
  yield outboxUpdated == 1).transact(transactor)

  override def rearmQueuedForRedelivery(
      now: Instant,
      redeliverBefore: Instant,
      limit: Int,
  ): F[Int] = sql"""
      WITH candidates AS (
        SELECT q.id
        FROM ocr_queue_outbox q
        JOIN ocr_jobs j ON j.id = q.job_id
        WHERE q.status = ${OcrQueueOutboxStatus.Delivered}
          AND q.delivered_at <= $redeliverBefore
          AND q.schema_version = 2
          AND j.status = 'queued'
          AND j.queue_schema_version = 2
          AND j.attempt_count = 0
        ORDER BY q.delivered_at, q.created_at, q.id
        LIMIT $limit
        FOR UPDATE OF q, j SKIP LOCKED
      )
      UPDATE ocr_queue_outbox q
      SET
        status = ${OcrQueueOutboxStatus.Pending},
        attempt_count = 0,
        last_error = NULL,
        claim_token = NULL,
        claim_expires_at = NULL,
        next_attempt_at = $now,
        delivered_at = NULL,
        redis_message_id = NULL,
        updated_at = $now
      FROM candidates
      WHERE q.id = candidates.id
    """.update.run.transact(transactor)

  override def nextWakeAt(
      now: Instant,
      redeliveryAfter: FiniteDuration,
  ): F[Option[Instant]] =
    val redeliveryMillis = redeliveryAfter.toMillis
    sql"""
      SELECT MIN(wake_at)
      FROM (
        SELECT next_attempt_at AS wake_at
        FROM ocr_queue_outbox
        WHERE status = ${OcrQueueOutboxStatus.Pending}
        UNION ALL
        SELECT claim_expires_at AS wake_at
        FROM ocr_queue_outbox
        WHERE status = ${OcrQueueOutboxStatus.InFlight}
        UNION ALL
        SELECT q.delivered_at + ($redeliveryMillis * INTERVAL '1 millisecond') AS wake_at
        FROM ocr_queue_outbox q
        JOIN ocr_jobs j ON j.id = q.job_id
        WHERE q.status = ${OcrQueueOutboxStatus.Delivered}
          AND j.status = 'queued'
          AND q.schema_version = 2
          AND j.queue_schema_version = 2
          AND j.attempt_count = 0
          AND q.delivered_at IS NOT NULL
        UNION ALL
        SELECT $now AS wake_at
        WHERE EXISTS (
          SELECT 1
          FROM ocr_queue_outbox q
          JOIN ocr_jobs j ON j.id = q.job_id
          WHERE q.status = ${OcrQueueOutboxStatus.Delivered}
            AND j.status = ${OcrJobStatus.Queued}
            AND (q.schema_version <> 2 OR j.queue_schema_version <> 2)
        )
      ) deadlines
      WHERE wake_at IS NOT NULL
    """.query[Option[Instant]].unique.transact(transactor)

  override def backlogSnapshot(now: Instant): F[OcrQueueBacklogSnapshot] = sql"""
      SELECT
        COUNT(*) FILTER (WHERE q.status = ${OcrQueueOutboxStatus.Pending}) AS pending_count,
        COUNT(*) FILTER (WHERE q.status = ${OcrQueueOutboxStatus.InFlight}) AS in_flight_count,
        COUNT(*) FILTER (
          WHERE q.status = ${OcrQueueOutboxStatus.InFlight}
            AND q.claim_expires_at <= $now
        ) AS expired_in_flight_count,
        COUNT(*) FILTER (
          WHERE q.status = ${OcrQueueOutboxStatus.Pending}
            AND q.next_attempt_at <= $now
        ) AS due_pending_count,
        MIN(q.next_attempt_at) FILTER (
          WHERE q.status = ${OcrQueueOutboxStatus.Pending}
            AND q.next_attempt_at <= $now
        ) AS oldest_due_next_attempt_at,
        COUNT(*) FILTER (
          WHERE q.status = ${OcrQueueOutboxStatus.Delivered}
            AND j.status = ${OcrJobStatus.Queued}
            AND (q.schema_version <> 2 OR j.queue_schema_version <> 2)
        ) AS recoverable_invalid_count
      FROM ocr_queue_outbox q
      JOIN ocr_jobs j ON j.id = q.job_id
      WHERE q.status = ${OcrQueueOutboxStatus.Pending}
         OR q.status = ${OcrQueueOutboxStatus.InFlight}
         OR (
           q.status = ${OcrQueueOutboxStatus.Delivered}
           AND j.status = ${OcrJobStatus.Queued}
           AND (q.schema_version <> 2 OR j.queue_schema_version <> 2)
         )
    """.query[BacklogSnapshotRow].unique.map(_.toSnapshot).transact(transactor)

  override def markDelivered(
      id: String,
      claimToken: UUID,
      redisMessageId: String,
      now: Instant,
  ): F[Boolean] = sql"""
      UPDATE ocr_queue_outbox
      SET
        status = ${OcrQueueOutboxStatus.Delivered},
        claim_token = NULL,
        claim_expires_at = NULL,
        delivered_at = $now,
        redis_message_id = $redisMessageId,
        updated_at = $now
      WHERE id = $id
        AND status = ${OcrQueueOutboxStatus.InFlight}
        AND claim_token = $claimToken
    """.update.run.map(_ == 1).transact(transactor)

  override def releaseForRetry(
      id: String,
      claimToken: UUID,
      lastError: String,
      nextAttemptAt: Instant,
      now: Instant,
  ): F[Boolean] = sql"""
      UPDATE ocr_queue_outbox
      SET
        status = ${OcrQueueOutboxStatus.Pending},
        attempt_count = attempt_count + 1,
        last_error = $lastError,
        claim_token = NULL,
        claim_expires_at = NULL,
        next_attempt_at = $nextAttemptAt,
        updated_at = $now
      WHERE id = $id
        AND status = ${OcrQueueOutboxStatus.InFlight}
        AND claim_token = $claimToken
    """.update.run.map(_ == 1).transact(transactor)
