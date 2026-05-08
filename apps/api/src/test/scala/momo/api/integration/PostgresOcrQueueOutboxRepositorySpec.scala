package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ids.*
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.postgres.PostgresOcrQueueOutboxRepository
import momo.api.repositories.{OcrQueueOutboxStatus, OcrQueuePayload}

final class PostgresOcrQueueOutboxRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-08T15:00:00Z")
  private val claimUntil = now.plusSeconds(60)

  private def repo = PostgresOcrQueueOutboxRepository[IO](transactor)

  private def payload(jobId: OcrJobId): OcrQueuePayload = OcrQueuePayload(Map(
    "jobId" -> jobId.value,
    "attempt" -> "1",
    "enqueuedAt" -> now.toString,
  ))

  private def insertOcrRows(jobId: OcrJobId, draftId: OcrDraftId, createdAt: Instant): IO[Unit] =
    (for
      _ <- sql"""
        INSERT INTO ocr_drafts (
          id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
          created_at, updated_at
        ) VALUES (
          $draftId, $jobId, 'total_assets', '{}', '[]', '{}', $createdAt, $createdAt
        )
      """.update.run
      _ <- sql"""
        INSERT INTO ocr_jobs (
          id, draft_id, image_id, image_path, requested_screen_type, status, attempt_count,
          created_at, updated_at
        ) VALUES (
          $jobId, $draftId, ${ImageId(s"image-${jobId.value}")}, '/tmp/outbox.png',
          'total_assets', 'queued', 0, $createdAt, $createdAt
        )
      """.update.run
    yield ()).transact(transactor)

  private def insertOutbox(
      id: String,
      jobId: OcrJobId,
      status: OcrQueueOutboxStatus,
      attemptCount: Int,
      nextAttemptAt: Instant,
      claimExpiresAt: Option[Instant],
      createdAt: Instant,
  ): IO[Unit] =
    val payloadJson = OcrQueuePayload.fieldsAsJson(payload(jobId))
    sql"""
      INSERT INTO ocr_queue_outbox (
        id, job_id, dedupe_key, stream_payload,
        status, attempt_count, claim_expires_at, next_attempt_at,
        created_at, updated_at
      ) VALUES (
        $id, $jobId, ${s"ocr-job:${jobId.value}"}, $payloadJson,
        $status, $attemptCount, $claimExpiresAt, $nextAttemptAt,
        $createdAt, $createdAt
      )
    """.update.run.transact(transactor).map(_ => ())

  test("claimDue claims due pending and expired in-flight rows in deterministic order"):
    val pendingJobId = OcrJobId("job-outbox-pending")
    val expiredJobId = OcrJobId("job-outbox-expired")
    val futureJobId = OcrJobId("job-outbox-future")
    for
      _ <- insertOcrRows(pendingJobId, OcrDraftId("draft-outbox-pending"), now.minusSeconds(300))
      _ <- insertOcrRows(expiredJobId, OcrDraftId("draft-outbox-expired"), now.minusSeconds(240))
      _ <- insertOcrRows(futureJobId, OcrDraftId("draft-outbox-future"), now.minusSeconds(180))
      _ <- insertOutbox(
        id = "outbox-pending",
        jobId = pendingJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(60),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(300),
      )
      _ <- insertOutbox(
        id = "outbox-expired",
        jobId = expiredJobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 2,
        nextAttemptAt = now.minusSeconds(120),
        claimExpiresAt = Some(now.minusSeconds(1)),
        createdAt = now.minusSeconds(240),
      )
      _ <- insertOutbox(
        id = "outbox-future",
        jobId = futureJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.plusSeconds(60),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(180),
      )
      claimed <- repo.claimDue(limit = 2, now = now, claimUntil = claimUntil)
      states <- sql"""
        SELECT id, status, claim_expires_at
        FROM ocr_queue_outbox
        ORDER BY id
      """.query[(String, String, Option[Instant])].to[List].transact(transactor)
    yield
      assertEquals(claimed.map(_.id), List("outbox-expired", "outbox-pending"))
      assertEquals(claimed.map(_.attemptCount), List(2, 0))
      assertEquals(claimed.map(_.payload.fields("jobId")), List(expiredJobId.value, pendingJobId.value))
      assertEquals(
        states,
        List(
          ("outbox-expired", "IN_FLIGHT", Some(claimUntil)),
          ("outbox-future", "PENDING", None),
          ("outbox-pending", "IN_FLIGHT", Some(claimUntil)),
        ),
      )

  test("markDelivered stores Redis message id and clears the claim"):
    val jobId = OcrJobId("job-outbox-delivered")
    val deliveredAt = now.plusSeconds(10)
    for
      _ <- insertOcrRows(jobId, OcrDraftId("draft-outbox-delivered"), now.minusSeconds(60))
      _ <- insertOutbox(
        id = "outbox-delivered",
        jobId = jobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 1,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = Some(claimUntil),
        createdAt = now.minusSeconds(60),
      )
      _ <- repo.markDelivered("outbox-delivered", "1700000000000-0", deliveredAt)
      row <- sql"""
        SELECT status, claim_expires_at, delivered_at, redis_message_id
        FROM ocr_queue_outbox
        WHERE id = 'outbox-delivered'
      """.query[(String, Option[Instant], Option[Instant], Option[String])].unique.transact(
        transactor
      )
    yield assertEquals(row, ("DELIVERED", None, Some(deliveredAt), Some("1700000000000-0")))

  test("releaseForRetry increments attempts, records sanitized error class, and reschedules"):
    val jobId = OcrJobId("job-outbox-retry")
    val nextAttemptAt = now.plusSeconds(120)
    val releasedAt = now.plusSeconds(5)
    for
      _ <- insertOcrRows(jobId, OcrDraftId("draft-outbox-retry"), now.minusSeconds(60))
      _ <- insertOutbox(
        id = "outbox-retry",
        jobId = jobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 1,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = Some(claimUntil),
        createdAt = now.minusSeconds(60),
      )
      _ <- repo.releaseForRetry(
        id = "outbox-retry",
        lastError = "RuntimeException",
        nextAttemptAt = nextAttemptAt,
        now = releasedAt,
      )
      row <- sql"""
        SELECT status, attempt_count, last_error, claim_expires_at, next_attempt_at, updated_at
        FROM ocr_queue_outbox
        WHERE id = 'outbox-retry'
      """.query[(String, Int, Option[String], Option[Instant], Instant, Instant)].unique.transact(
        transactor
      )
    yield assertEquals(row, ("PENDING", 2, Some("RuntimeException"), None, nextAttemptAt, releasedAt))

  test("claimDue rejects non-string stream payload fields and rolls back the claim"):
    val jobId = OcrJobId("job-outbox-invalid-payload")
    for
      _ <- insertOcrRows(jobId, OcrDraftId("draft-outbox-invalid-payload"), now.minusSeconds(60))
      _ <- sql"""
        INSERT INTO ocr_queue_outbox (
          id, job_id, dedupe_key, stream_payload,
          status, attempt_count, next_attempt_at, created_at, updated_at
        ) VALUES (
          'outbox-invalid-payload', $jobId, 'ocr-job:job-outbox-invalid-payload',
          '{"attempt": 1}'::jsonb, ${OcrQueueOutboxStatus.Pending}, 0,
          ${now.minusSeconds(1)}, ${now.minusSeconds(60)}, ${now.minusSeconds(60)}
        )
      """.update.run.transact(transactor)
      result <- repo.claimDue(limit = 1, now = now, claimUntil = claimUntil).attempt
      status <- sql"""
        SELECT status
        FROM ocr_queue_outbox
        WHERE id = 'outbox-invalid-payload'
      """.query[String].unique.transact(transactor)
    yield
      result match
        case Left(error: IllegalStateException) =>
          assert(error.getMessage.contains("invalid stream_payload"), error.getMessage)
          assert(error.getMessage.contains("field attempt must be a string"), error.getMessage)
        case other => fail(s"expected invalid payload failure, got: $other")
      assertEquals(status, "PENDING")
