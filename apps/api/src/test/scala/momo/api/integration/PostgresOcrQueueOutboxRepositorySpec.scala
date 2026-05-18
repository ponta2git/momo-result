package momo.api.integration

import java.nio.file.Path
import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.postgres.PostgresOcrQueueOutboxRepository
import momo.api.repositories.{OcrQueueOutboxStatus, OcrQueuePayload}

final class PostgresOcrQueueOutboxRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-08T15:00:00Z")
  private val claimUntil = now.plusSeconds(60)

  private def repo = PostgresOcrQueueOutboxRepository[IO](transactor)

  private def payload(jobId: OcrJobId): OcrQueuePayload = OcrQueuePayload.build(
    jobId = jobId,
    draftId = OcrDraftId.unsafeFromString(s"draft-${jobId.value}"),
    imageId = ImageId.unsafeFromString(s"image-${jobId.value}"),
    imagePath = Path.of("/tmp/outbox.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attempt = 1,
    enqueuedAt = now,
    hints = OcrJobHints.empty,
    requestId = None,
  )

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
          $jobId, $draftId, ${ImageId.unsafeFromString(s"image-${jobId.value}")}, '/tmp/outbox.png',
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
    val pendingJobId = OcrJobId.unsafeFromString("job-outbox-pending")
    val expiredJobId = OcrJobId.unsafeFromString("job-outbox-expired")
    val futureJobId = OcrJobId.unsafeFromString("job-outbox-future")
    for
      _ <- insertOcrRows(
        pendingJobId,
        OcrDraftId.unsafeFromString("draft-outbox-pending"),
        now.minusSeconds(300),
      )
      _ <- insertOcrRows(
        expiredJobId,
        OcrDraftId.unsafeFromString("draft-outbox-expired"),
        now.minusSeconds(240),
      )
      _ <- insertOcrRows(
        futureJobId,
        OcrDraftId.unsafeFromString("draft-outbox-future"),
        now.minusSeconds(180),
      )
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
      assertEquals(
        claimed.map(_.payload.fields("jobId")),
        List(expiredJobId.value, pendingJobId.value),
      )
      assertEquals(claimed.map(_.claimExpiresAt), List(claimUntil, claimUntil))
      assertEquals(
        states,
        List(
          ("outbox-expired", "IN_FLIGHT", Some(claimUntil)),
          ("outbox-future", "PENDING", None),
          ("outbox-pending", "IN_FLIGHT", Some(claimUntil)),
        ),
      )

  test("claimById claims only the requested pending row"):
    val targetJobId = OcrJobId.unsafeFromString("job-outbox-claim-target")
    val otherJobId = OcrJobId.unsafeFromString("job-outbox-claim-other")
    for
      _ <- insertOcrRows(
        targetJobId,
        OcrDraftId.unsafeFromString("draft-outbox-claim-target"),
        now.minusSeconds(120),
      )
      _ <- insertOcrRows(
        otherJobId,
        OcrDraftId.unsafeFromString("draft-outbox-claim-other"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = "outbox-claim-target",
        jobId = targetJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.plusSeconds(3600),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(120),
      )
      _ <- insertOutbox(
        id = "outbox-claim-other",
        jobId = otherJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(60),
      )
      claimed <- repo.claimById("outbox-claim-target", now = now, claimUntil = claimUntil)
      states <- sql"""
        SELECT id, status, claim_expires_at
        FROM ocr_queue_outbox
        WHERE id IN ('outbox-claim-target', 'outbox-claim-other')
        ORDER BY id
      """.query[(String, String, Option[Instant])].to[List].transact(transactor)
    yield
      assertEquals(claimed.map(_.id), Some("outbox-claim-target"))
      assertEquals(claimed.map(_.payload.fields("jobId")), Some(targetJobId.value))
      assertEquals(claimed.map(_.claimExpiresAt), Some(claimUntil))
      assertEquals(
        states,
        List(
          ("outbox-claim-other", "PENDING", None),
          ("outbox-claim-target", "IN_FLIGHT", Some(claimUntil)),
        ),
      )

  test("claimById ignores delivered and missing rows"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-claim-delivered")
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-claim-delivered"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = "outbox-claim-delivered",
        jobId = jobId,
        status = OcrQueueOutboxStatus.Delivered,
        attemptCount = 1,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(60),
      )
      delivered <- repo.claimById("outbox-claim-delivered", now = now, claimUntil = claimUntil)
      missing <- repo.claimById("outbox-claim-missing", now = now, claimUntil = claimUntil)
      row <- sql"""
        SELECT status, claim_expires_at
        FROM ocr_queue_outbox
        WHERE id = 'outbox-claim-delivered'
      """.query[(String, Option[Instant])].unique.transact(transactor)
    yield
      assertEquals(delivered, None)
      assertEquals(missing, None)
      assertEquals(row, ("DELIVERED", None))

  test("markDelivered stores Redis message id and clears the claim"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-delivered")
    val deliveredAt = now.plusSeconds(10)
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-delivered"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = "outbox-delivered",
        jobId = jobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 1,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = Some(claimUntil),
        createdAt = now.minusSeconds(60),
      )
      delivered <- repo
        .markDelivered("outbox-delivered", claimUntil, "1700000000000-0", deliveredAt)
      row <- sql"""
        SELECT status, claim_expires_at, delivered_at, redis_message_id
        FROM ocr_queue_outbox
        WHERE id = 'outbox-delivered'
      """.query[(String, Option[Instant], Option[Instant], Option[String])].unique
        .transact(transactor)
    yield
      assert(delivered)
      assertEquals(row, ("DELIVERED", None, Some(deliveredAt), Some("1700000000000-0")))

  test("releaseForRetry increments attempts, records sanitized error class, and reschedules"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-retry")
    val nextAttemptAt = now.plusSeconds(120)
    val releasedAt = now.plusSeconds(5)
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-retry"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = "outbox-retry",
        jobId = jobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 1,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = Some(claimUntil),
        createdAt = now.minusSeconds(60),
      )
      released <- repo.releaseForRetry(
        id = "outbox-retry",
        claimExpiresAt = claimUntil,
        lastError = "RuntimeException",
        nextAttemptAt = nextAttemptAt,
        now = releasedAt,
      )
      row <- sql"""
        SELECT status, attempt_count, last_error, claim_expires_at, next_attempt_at, updated_at
        FROM ocr_queue_outbox
        WHERE id = 'outbox-retry'
      """.query[(String, Int, Option[String], Option[Instant], Instant, Instant)].unique
        .transact(transactor)
    yield
      assert(released)
      assertEquals(row, ("PENDING", 2, Some("RuntimeException"), None, nextAttemptAt, releasedAt))

  test("releaseForRetry ignores stale claims and does not reopen delivered rows"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-stale-release")
    val deliveredAt = now.plusSeconds(10)
    val staleReleaseAt = now.plusSeconds(20)
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-stale-release"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = "outbox-stale-release",
        jobId = jobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 1,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = Some(claimUntil),
        createdAt = now.minusSeconds(60),
      )
      delivered <- repo
        .markDelivered("outbox-stale-release", claimUntil, "1700000000001-0", deliveredAt)
      released <- repo.releaseForRetry(
        id = "outbox-stale-release",
        claimExpiresAt = claimUntil,
        lastError = "RuntimeException",
        nextAttemptAt = now.plusSeconds(120),
        now = staleReleaseAt,
      )
      row <- sql"""
        SELECT status, attempt_count, last_error, claim_expires_at, delivered_at, redis_message_id,
               updated_at
        FROM ocr_queue_outbox
        WHERE id = 'outbox-stale-release'
      """
        .query[
          (String, Int, Option[String], Option[Instant], Option[Instant], Option[String], Instant)
        ].unique.transact(transactor)
    yield
      assert(delivered)
      assertEquals(released, false)
      assertEquals(
        row,
        ("DELIVERED", 1, None, None, Some(deliveredAt), Some("1700000000001-0"), deliveredAt),
      )

  test("claimDue rejects non-string stream payload fields and rolls back the claim"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-invalid-payload")
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-payload"),
        now.minusSeconds(60),
      )
      _ <- sql"""
        INSERT INTO ocr_queue_outbox (
          id, job_id, dedupe_key, stream_payload,
          status, attempt_count, next_attempt_at, created_at, updated_at
        ) VALUES (
          'outbox-invalid-payload', $jobId, 'ocr-job:job-outbox-invalid-payload',
          '{
            "schemaVersion": "1",
            "jobId": "job-outbox-invalid-payload",
            "draftId": "draft-outbox-invalid-payload",
            "imageId": "image-job-outbox-invalid-payload",
            "imagePath": "/tmp/outbox.png",
            "requestedScreenType": "total_assets",
            "attempt": 1,
            "enqueuedAt": "2026-05-08T15:00:00Z"
          }'::jsonb, ${OcrQueueOutboxStatus.Pending}, 0,
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
