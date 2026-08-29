package momo.api.integration
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.PostgresOcrQueueOutboxRepository
import momo.api.contracts.ocrworker.OcrWorkerJobMessageV2
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.ports.storage.{Sha256Hex, SourceImageIdempotencyHash, SourceImageObjectKey}
import momo.api.repositories.{
  InvalidOcrQueueOutboxClaim,
  OcrQueueOutboxClaim,
  OcrQueueOutboxDraft,
  OcrQueueOutboxRecord,
  OcrQueueOutboxStatus
}

final class PostgresOcrQueueOutboxRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-08T15:00:00Z")
  private val claimUntil = now.plusSeconds(60)

  private def claimTokenFor(id: String): UUID = UUID
    .nameUUIDFromBytes(id.getBytes(StandardCharsets.UTF_8))

  private def repo = PostgresOcrQueueOutboxRepository[IO](transactor)

  private def imageIdFor(jobId: OcrJobId): ImageId =
    ImageId.unsafeFromString(s"image-${jobId.value}")

  private def imageObjectKeyFor(jobId: OcrJobId): SourceImageObjectKey =
    SourceImageObjectKey.forImage(imageIdFor(jobId), "png").fold(fail(_), identity)

  private def workerMessage(jobId: OcrJobId): OcrWorkerJobMessageV2 =
    OcrWorkerJobMessageV2.build(
      jobId = jobId,
      draftId = OcrDraftId.unsafeFromString(s"draft-${jobId.value}"),
      sourceImageId = imageIdFor(jobId),
      imageObjectKey = imageObjectKeyFor(jobId).value,
      sha256 = "a" * 64,
      byteLength = 128,
      mediaType = "image/png",
      requestedScreenType = ScreenType.TotalAssets,
      attempt = 1,
      enqueuedAt = now,
      hints = OcrJobHints.empty,
      requestId = None,
    ).fold(fail(_), identity)

  private def insertOcrRows(
      jobId: OcrJobId,
      draftId: OcrDraftId,
      createdAt: Instant,
  ): IO[Unit] = insertOcrRowsWithContract(
    jobId,
    draftId,
    createdAt,
    queueSchemaVersion = 2.toShort,
    attemptCount = 0,
  )

  private def insertOcrRowsWithContract(
      jobId: OcrJobId,
      draftId: OcrDraftId,
      createdAt: Instant,
      queueSchemaVersion: Short,
      attemptCount: Int,
  ): IO[Unit] =
    (for
      _ <- sql"""
        INSERT INTO source_images (
          id, owner_account_id, object_key, idempotency_key_hash, status,
          media_type, byte_length, sha256_hex, width, height,
          available_at, created_at, updated_at
        ) VALUES (
          ${imageIdFor(jobId)}, 'account_ponta', ${imageObjectKeyFor(jobId)},
          ${SourceImageIdempotencyHash.uniqueFor(imageIdFor(jobId))}, 'AVAILABLE',
          'image/png', 128, ${Sha256Hex.fromString("a" * 64).fold(fail(_), identity)},
          1920, 1080, $createdAt, $createdAt, $createdAt
        )
      """.update.run
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
          id, draft_id, image_id, image_path, source_image_id, queue_schema_version,
          requested_screen_type, status, attempt_count, created_at, updated_at
        ) VALUES (
          $jobId, $draftId, ${imageIdFor(jobId)}, ${imageObjectKeyFor(jobId).value},
          ${imageIdFor(jobId)}, $queueSchemaVersion, 'total_assets', 'queued', $attemptCount,
          $createdAt, $createdAt
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
  ): IO[Unit] = insertOutboxRow(
    id,
    jobId,
    status,
    attemptCount,
    nextAttemptAt,
    claimExpiresAt,
    createdAt,
    schemaVersion = 2.toShort,
    payloadJson = OcrWorkerJobMessageV2.fieldsAsJson(workerMessage(jobId)),
  )

  private def insertOutboxWithSchema(
      id: String,
      jobId: OcrJobId,
      status: OcrQueueOutboxStatus,
      attemptCount: Int,
      nextAttemptAt: Instant,
      claimExpiresAt: Option[Instant],
      createdAt: Instant,
      schemaVersion: Short,
  ): IO[Unit] = insertOutboxRow(
    id,
    jobId,
    status,
    attemptCount,
    nextAttemptAt,
    claimExpiresAt,
    createdAt,
    schemaVersion,
    OcrWorkerJobMessageV2.fieldsAsJson(workerMessage(jobId)),
  )

  private def insertOutboxWithPayload(
      id: String,
      jobId: OcrJobId,
      status: OcrQueueOutboxStatus,
      attemptCount: Int,
      nextAttemptAt: Instant,
      claimExpiresAt: Option[Instant],
      createdAt: Instant,
      payloadJson: Json,
  ): IO[Unit] = insertOutboxRow(
    id,
    jobId,
    status,
    attemptCount,
    nextAttemptAt,
    claimExpiresAt,
    createdAt,
    schemaVersion = 2.toShort,
    payloadJson = payloadJson,
  )

  private def insertOutboxRow(
      id: String,
      jobId: OcrJobId,
      status: OcrQueueOutboxStatus,
      attemptCount: Int,
      nextAttemptAt: Instant,
      claimExpiresAt: Option[Instant],
      createdAt: Instant,
      schemaVersion: Short,
      payloadJson: Json,
  ): IO[Unit] =
    val claimToken = claimExpiresAt.map(_ => claimTokenFor(id))
    sql"""
      INSERT INTO ocr_queue_outbox (
        id, job_id, dedupe_key, schema_version, stream_payload,
        status, attempt_count, claim_token, claim_expires_at, next_attempt_at,
        created_at, updated_at
      ) VALUES (
        $id, $jobId, ${s"ocr-job:${jobId.value}"}, $schemaVersion, $payloadJson,
        $status, $attemptCount, $claimToken, $claimExpiresAt, $nextAttemptAt,
        $createdAt, $createdAt
      )
    """.update.run.transact(transactor).map(_ => ())

  private def publishedRecord(claim: OcrQueueOutboxClaim): OcrQueueOutboxRecord = claim match
    case OcrQueueOutboxClaim.Publish(record) => record
    case other => fail(s"expected publishable claim, got: $other")

  private def invalidClaim(claim: OcrQueueOutboxClaim): InvalidOcrQueueOutboxClaim = claim match
    case OcrQueueOutboxClaim.Invalid(invalid) => invalid
    case other => fail(s"expected invalid claim, got: $other")

  test("claimDue claims due pending and expired in-flight rows in deterministic order"):
    val pendingJobId = OcrJobId.unsafeFromString("job-outbox-pending")
    val expiredJobId = OcrJobId.unsafeFromString("job-outbox-expired")
    val futureJobId = OcrJobId.unsafeFromString("job-outbox-future")
    val pendingOutboxId = OcrQueueOutboxDraft.idForJob(pendingJobId)
    val expiredOutboxId = OcrQueueOutboxDraft.idForJob(expiredJobId)
    val futureOutboxId = OcrQueueOutboxDraft.idForJob(futureJobId)
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
        id = pendingOutboxId,
        jobId = pendingJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(60),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(300),
      )
      _ <- insertOutbox(
        id = expiredOutboxId,
        jobId = expiredJobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 2,
        nextAttemptAt = now.minusSeconds(120),
        claimExpiresAt = Some(now.minusSeconds(1)),
        createdAt = now.minusSeconds(240),
      )
      _ <- insertOutbox(
        id = futureOutboxId,
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
      val records = claimed.map(publishedRecord)
      assertEquals(records.map(_.id), List(expiredOutboxId, pendingOutboxId))
      assertEquals(records.map(_.attemptCount), List(2, 0))
      assertEquals(
        records.map(_.enqueueRequest.jobId.value),
        List(expiredJobId.value, pendingJobId.value),
      )
      assertEquals(records.map(_.claimExpiresAt), List(claimUntil, claimUntil))
      assertEquals(records.map(_.claimToken).distinct.size, 2)
      assertEquals(
        states,
        List(
          (expiredOutboxId, "IN_FLIGHT", Some(claimUntil)),
          (futureOutboxId, "PENDING", None),
          (pendingOutboxId, "IN_FLIGHT", Some(claimUntil)),
        ),
      )

  test("semantic redelivery rearms only stale delivered rows whose job is still queued"):
    val oldQueued = OcrJobId.unsafeFromString("job-outbox-semantic-old")
    val retriedQueued = OcrJobId.unsafeFromString("job-outbox-semantic-retried")
    val legacyQueued = OcrJobId.unsafeFromString("job-outbox-semantic-legacy")
    val recentQueued = OcrJobId.unsafeFromString("job-outbox-semantic-recent")
    val running = OcrJobId.unsafeFromString("job-outbox-semantic-running")
    val terminal = OcrJobId.unsafeFromString("job-outbox-semantic-terminal")
    val jobs = List(oldQueued, retriedQueued, legacyQueued, recentQueued, running, terminal)
    for
      _ <- jobs.zipWithIndex.traverse_ { case (jobId, index) =>
        insertOcrRowsWithContract(
          jobId,
          OcrDraftId.unsafeFromString(s"draft-${jobId.value}"),
          now.minusSeconds(600L - index.toLong),
          queueSchemaVersion = (if jobId == legacyQueued then 1 else 2).toShort,
          attemptCount = if jobId == retriedQueued then 1 else 0,
        ) >> insertOutboxWithSchema(
          id = s"outbox-${jobId.value}",
          jobId = jobId,
          status = OcrQueueOutboxStatus.Delivered,
          attemptCount = 2,
          nextAttemptAt = now.minusSeconds(300),
          claimExpiresAt = None,
          createdAt = now.minusSeconds(600L - index.toLong),
          schemaVersion = (if jobId == legacyQueued then 1 else 2).toShort,
        )
      }
      _ <- sql"""
        UPDATE ocr_queue_outbox
        SET delivered_at = CASE
              WHEN job_id = $recentQueued THEN ${now.minusSeconds(30)}
              ELSE ${now.minusSeconds(180)}
            END,
            redis_message_id = 'existing-message',
            last_error = 'old-error'
      """.update.run.transact(transactor)
      _ <- sql"UPDATE ocr_jobs SET status = 'running' WHERE id = $running".update.run
        .transact(transactor)
      _ <- sql"UPDATE ocr_jobs SET status = 'failed' WHERE id = $terminal".update.run
        .transact(transactor)
      rearmed <- repo.rearmQueuedForRedelivery(now, now.minusSeconds(120), 10)
      rows <- sql"""
        SELECT job_id, status, attempt_count, last_error, next_attempt_at,
               delivered_at, redis_message_id
        FROM ocr_queue_outbox
        ORDER BY job_id
      """.query[(String, String, Int, Option[String], Instant, Option[Instant], Option[String])]
        .to[List].transact(transactor)
    yield
      assertEquals(rearmed, 1)
      assertEquals(
        rows.find(_._1 == oldQueued.value),
        Some((oldQueued.value, "PENDING", 0, None, now, None, None)),
      )
      assertEquals(rows.filterNot(_._1 == oldQueued.value).map(_._2).distinct, List("DELIVERED"))

  test("legacy delivered queued rows remain immediate recoverable backlog and converge"):
    val queuedJobId = OcrJobId.unsafeFromString("job-outbox-legacy-delivered-queued")
    val runningJobId = OcrJobId.unsafeFromString("job-outbox-legacy-delivered-running")
    val terminalJobId = OcrJobId.unsafeFromString("job-outbox-legacy-delivered-terminal")
    val jobs = List(queuedJobId, runningJobId, terminalJobId)
    val outboxId = OcrQueueOutboxDraft.idForJob(queuedJobId)
    for
      _ <- jobs.traverse_(jobId =>
        insertOcrRowsWithContract(
          jobId,
          OcrDraftId.unsafeFromString(s"draft-${jobId.value}"),
          now.minusSeconds(180),
          queueSchemaVersion = 1.toShort,
          attemptCount = if jobId == queuedJobId then 1 else 0,
        ) >> insertOutboxWithSchema(
          id = OcrQueueOutboxDraft.idForJob(jobId),
          jobId = jobId,
          status = OcrQueueOutboxStatus.Delivered,
          attemptCount = 0,
          nextAttemptAt = now.minusSeconds(180),
          claimExpiresAt = None,
          createdAt = now.minusSeconds(180),
          schemaVersion = 1.toShort,
        )
      )
      _ <- sql"""
        UPDATE ocr_queue_outbox
        SET delivered_at = ${now.minusSeconds(150)}, redis_message_id = 'legacy-message'
      """.update.run.transact(transactor)
      _ <- sql"UPDATE ocr_jobs SET status = 'running' WHERE id = $runningJobId".update.run
        .transact(transactor)
      _ <- sql"UPDATE ocr_jobs SET status = 'failed' WHERE id = $terminalJobId".update.run
        .transact(transactor)
      snapshot <- repo.backlogSnapshot(now)
      nextWakeAt <- repo.nextWakeAt(now, 120.seconds)
      claim <- repo.claimDue(3, now, claimUntil)
        .map(claims => invalidClaim(claims.headOption.getOrElse(fail("legacy claim missing"))))
      failed <- repo.failInvalidClaim(claim, now.plusSeconds(1))
      queuedJobStatus <- sql"SELECT status FROM ocr_jobs WHERE id = $queuedJobId".query[String]
        .unique.transact(transactor)
      finalSnapshot <- repo.backlogSnapshot(now.plusSeconds(1))
      ownerOutboxStates <- sql"""
        SELECT q.job_id, q.status
        FROM ocr_queue_outbox q
        WHERE q.job_id IN ($runningJobId, $terminalJobId)
        ORDER BY q.job_id
      """.query[(String, String)].to[List].transact(transactor)
    yield
      assertEquals(snapshot.recoverableInvalidCount, 1L)
      assertEquals(snapshot.activeBacklogCount, 1L)
      assertEquals(snapshot.dueBacklogCount, 1L)
      assertEquals(nextWakeAt, Some(now))
      assertEquals(claim.id, outboxId)
      assert(failed)
      assertEquals(queuedJobStatus, "failed")
      assertEquals(finalSnapshot.recoverableInvalidCount, 0L)
      assertEquals(finalSnapshot.activeBacklogCount, 0L)
      assertEquals(
        ownerOutboxStates,
        List((runningJobId.value, "DELIVERED"), (terminalJobId.value, "DELIVERED")),
      )

  test("nextWakeAt chooses the earliest pending, claim-expiry, or semantic deadline"):
    val pending = OcrJobId.unsafeFromString("job-outbox-deadline-pending")
    val inFlight = OcrJobId.unsafeFromString("job-outbox-deadline-in-flight")
    val delivered = OcrJobId.unsafeFromString("job-outbox-deadline-delivered")
    val retriedDelivered = OcrJobId.unsafeFromString("job-outbox-deadline-retried")
    for
      _ <- List(pending, inFlight, delivered, retriedDelivered).traverse_(jobId =>
        insertOcrRowsWithContract(
          jobId,
          OcrDraftId.unsafeFromString(s"draft-${jobId.value}"),
          now.minusSeconds(60),
          queueSchemaVersion = 2.toShort,
          attemptCount = if jobId == retriedDelivered then 1 else 0,
        )
      )
      _ <- insertOutbox(
        "outbox-deadline-pending",
        pending,
        OcrQueueOutboxStatus.Pending,
        0,
        now.plusSeconds(90),
        None,
        now,
      )
      _ <- insertOutbox(
        "outbox-deadline-in-flight",
        inFlight,
        OcrQueueOutboxStatus.InFlight,
        0,
        now,
        Some(now.plusSeconds(30)),
        now,
      )
      _ <- insertOutbox(
        "outbox-deadline-delivered",
        delivered,
        OcrQueueOutboxStatus.Delivered,
        0,
        now,
        None,
        now,
      )
      _ <- insertOutbox(
        "outbox-deadline-retried",
        retriedDelivered,
        OcrQueueOutboxStatus.Delivered,
        0,
        now,
        None,
        now,
      )
      _ <- sql"""
        UPDATE ocr_queue_outbox
        SET delivered_at = CASE
              WHEN id = 'outbox-deadline-retried' THEN ${now.minusSeconds(180)}
              ELSE ${now.minusSeconds(20)}
            END,
            redis_message_id = 'existing-message'
        WHERE id IN ('outbox-deadline-delivered', 'outbox-deadline-retried')
      """.update.run.transact(transactor)
      deadline <- repo.nextWakeAt(now, 120.seconds)
    yield assertEquals(deadline, Some(now.plusSeconds(30)))

  test("backlogSnapshot summarizes pending, due, and in-flight backlog"):
    val dueJobId = OcrJobId.unsafeFromString("job-outbox-snapshot-due")
    val futureJobId = OcrJobId.unsafeFromString("job-outbox-snapshot-future")
    val expiredJobId = OcrJobId.unsafeFromString("job-outbox-snapshot-expired")
    val activeJobId = OcrJobId.unsafeFromString("job-outbox-snapshot-active")
    val deliveredJobId = OcrJobId.unsafeFromString("job-outbox-snapshot-delivered")
    for
      _ <- insertOcrRows(
        dueJobId,
        OcrDraftId.unsafeFromString("draft-outbox-snapshot-due"),
        now.minusSeconds(300),
      )
      _ <- insertOcrRows(
        futureJobId,
        OcrDraftId.unsafeFromString("draft-outbox-snapshot-future"),
        now.minusSeconds(240),
      )
      _ <- insertOcrRows(
        expiredJobId,
        OcrDraftId.unsafeFromString("draft-outbox-snapshot-expired"),
        now.minusSeconds(180),
      )
      _ <- insertOcrRows(
        activeJobId,
        OcrDraftId.unsafeFromString("draft-outbox-snapshot-active"),
        now.minusSeconds(120),
      )
      _ <- insertOcrRows(
        deliveredJobId,
        OcrDraftId.unsafeFromString("draft-outbox-snapshot-delivered"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = "outbox-snapshot-due",
        jobId = dueJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 1,
        nextAttemptAt = now.minusSeconds(120),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(300),
      )
      _ <- insertOutbox(
        id = "outbox-snapshot-future",
        jobId = futureJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.plusSeconds(120),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(240),
      )
      _ <- insertOutbox(
        id = "outbox-snapshot-expired",
        jobId = expiredJobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 2,
        nextAttemptAt = now.minusSeconds(180),
        claimExpiresAt = Some(now.minusSeconds(1)),
        createdAt = now.minusSeconds(180),
      )
      _ <- insertOutbox(
        id = "outbox-snapshot-active",
        jobId = activeJobId,
        status = OcrQueueOutboxStatus.InFlight,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(60),
        claimExpiresAt = Some(now.plusSeconds(60)),
        createdAt = now.minusSeconds(120),
      )
      _ <- insertOutbox(
        id = "outbox-snapshot-delivered",
        jobId = deliveredJobId,
        status = OcrQueueOutboxStatus.Delivered,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(60),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(60),
      )
      snapshot <- repo.backlogSnapshot(now)
    yield
      assertEquals(snapshot.pendingCount, 2L)
      assertEquals(snapshot.inFlightCount, 2L)
      assertEquals(snapshot.expiredInFlightCount, 1L)
      assertEquals(snapshot.duePendingCount, 1L)
      assertEquals(snapshot.dueBacklogCount, 2L)
      assertEquals(snapshot.activeBacklogCount, 4L)
      assertEquals(snapshot.oldestDueNextAttemptAt, Some(now.minusSeconds(120)))

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
        .markDelivered(
          "outbox-delivered",
          claimTokenFor("outbox-delivered"),
          "1700000000000-0",
          deliveredAt,
        )
      row <- sql"""
        SELECT status, claim_token, claim_expires_at, delivered_at, redis_message_id
        FROM ocr_queue_outbox
        WHERE id = 'outbox-delivered'
      """.query[(String, Option[UUID], Option[Instant], Option[Instant], Option[String])].unique
        .transact(transactor)
    yield
      assert(delivered)
      assertEquals(row, ("DELIVERED", None, None, Some(deliveredAt), Some("1700000000000-0")))

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
        claimToken = claimTokenFor("outbox-retry"),
        lastError = "RuntimeException",
        nextAttemptAt = nextAttemptAt,
        now = releasedAt,
      )
      row <- sql"""
        SELECT status, attempt_count, last_error, claim_token, claim_expires_at,
               next_attempt_at, updated_at
        FROM ocr_queue_outbox
        WHERE id = 'outbox-retry'
      """.query[
        (String, Int, Option[String], Option[UUID], Option[Instant], Instant, Instant)
      ].unique
        .transact(transactor)
    yield
      assert(released)
      assertEquals(
        row,
        ("PENDING", 2, Some("RuntimeException"), None, None, nextAttemptAt, releasedAt),
      )

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
        .markDelivered(
          "outbox-stale-release",
          claimTokenFor("outbox-stale-release"),
          "1700000000001-0",
          deliveredAt,
        )
      released <- repo.releaseForRetry(
        id = "outbox-stale-release",
        claimToken = claimTokenFor("outbox-stale-release"),
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

  test("reclaimed rows reject terminal writes from the stale claim token"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-token-fence")
    val outboxId = OcrQueueOutboxDraft.idForJob(jobId)
    val firstClaimAt = now.minusSeconds(120)
    val firstClaimUntil = now.minusSeconds(1)
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-token-fence"),
        now.minusSeconds(180),
      )
      _ <- insertOutbox(
        id = outboxId,
        jobId = jobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = firstClaimAt,
        claimExpiresAt = None,
        createdAt = now.minusSeconds(180),
      )
      first <- repo.claimDue(1, firstClaimAt, firstClaimUntil)
        .map(claims =>
          publishedRecord(claims.headOption.getOrElse(fail("first claim was not acquired")))
        )
      second <- repo.claimDue(limit = 1, now = now, claimUntil = claimUntil)
        .map(claims =>
          publishedRecord(claims.headOption.getOrElse(fail("expired claim was not reclaimed")))
        )
      staleDelivered <- repo.markDelivered(
        outboxId,
        first.claimToken,
        "1700000000002-0",
        now.plusSeconds(1),
      )
      currentDelivered <- repo.markDelivered(
        outboxId,
        second.claimToken,
        "1700000000003-0",
        now.plusSeconds(2),
      )
      messageId <- sql"""
        SELECT redis_message_id
        FROM ocr_queue_outbox
        WHERE id = $outboxId
      """.query[Option[String]].unique.transact(transactor)
    yield
      assert(!first.claimToken.equals(second.claimToken))
      assertEquals(staleDelivered, false)
      assertEquals(currentDelivered, true)
      assertEquals(messageId, Some("1700000000003-0"))

  test("claimDue isolates malformed payloads while returning valid siblings for publication"):
    val invalidJobId = OcrJobId.unsafeFromString("job-outbox-invalid-payload")
    val validJobId = OcrJobId.unsafeFromString("job-outbox-valid-sibling")
    val invalidOutboxId = OcrQueueOutboxDraft.idForJob(invalidJobId)
    val validOutboxId = OcrQueueOutboxDraft.idForJob(validJobId)
    for
      _ <- insertOcrRows(
        invalidJobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-payload"),
        now.minusSeconds(120),
      )
      _ <- insertOcrRows(
        validJobId,
        OcrDraftId.unsafeFromString("draft-outbox-valid-sibling"),
        now.minusSeconds(60),
      )
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status, total_assets_draft_id,
          created_at, updated_at
        ) VALUES (
          'match-draft-outbox-invalid-payload', 'account_ponta', 'member_ponta', 'ocr_running',
          'draft-outbox-invalid-payload', ${now.minusSeconds(120)}, ${now.minusSeconds(120)}
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO ocr_queue_outbox (
          id, job_id, dedupe_key, schema_version, stream_payload,
          status, attempt_count, next_attempt_at, created_at, updated_at
        ) VALUES (
          $invalidOutboxId, $invalidJobId, 'ocr-job:job-outbox-invalid-payload', 2,
          '{
            "schemaVersion": "2",
            "jobId": "job-outbox-invalid-payload",
            "draftId": "draft-outbox-invalid-payload",
            "sourceImageId": "image-job-outbox-invalid-payload",
            "imageObjectKey": "source-images/v1/aa/image-job-outbox-invalid-payload.png",
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "byteLength": "128",
            "mediaType": "image/png",
            "requestedScreenType": "total_assets",
            "attempt": 1,
            "enqueuedAt": "2026-05-08T15:00:00Z"
          }'::jsonb, ${OcrQueueOutboxStatus.Pending}, 0,
          ${now.minusSeconds(1)}, ${now.minusSeconds(60)}, ${now.minusSeconds(60)}
        )
      """.update.run.transact(transactor)
      _ <- insertOutbox(
        id = validOutboxId,
        jobId = validJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(60),
      )
      claims <- repo.claimDue(limit = 2, now = now, claimUntil = claimUntil)
      invalid = invalidClaim(claims.head)
      valid = publishedRecord(claims(1))
      failed <- repo.failInvalidClaim(invalid, now.plusSeconds(1))
      outboxState <- sql"""
        SELECT status, last_error, claim_token, claim_expires_at
        FROM ocr_queue_outbox
        WHERE id = $invalidOutboxId
      """.query[(String, Option[String], Option[UUID], Option[Instant])].unique
        .transact(transactor)
      jobState <- sql"""
        SELECT status, failure_code, failure_message, failure_retryable,
               failure_user_action, finished_at, duration_ms
        FROM ocr_jobs
        WHERE id = $invalidJobId
      """.query[
        (
            String,
            Option[String],
            Option[String],
            Option[Boolean],
            Option[String],
            Option[Instant],
            Option[Int]
        )
      ].unique.transact(transactor)
      validState <- sql"""
        SELECT status
        FROM ocr_queue_outbox
        WHERE id = $validOutboxId
      """.query[String].unique.transact(transactor)
      matchDraftStatus <- sql"""
        SELECT status
        FROM match_drafts
        WHERE id = 'match-draft-outbox-invalid-payload'
      """.query[String].unique.transact(transactor)
    yield
      assertEquals(invalid.id, invalidOutboxId)
      assertEquals(valid.id, validOutboxId)
      assertEquals(valid.enqueueRequest.jobId, validJobId)
      assert(failed)
      assertEquals(outboxState, ("FAILED", Some("invalid_persisted_contract"), None, None))
      assertEquals(
        jobState,
        (
          "failed",
          Some("QUEUE_FAILURE"),
          Some("The OCR queue delivery failed its persisted contract."),
          Some(false),
          Some("運用担当者に連絡してください。"),
          Some(now.plusSeconds(1)),
          Some(0),
        ),
      )
      assertEquals(validState, "IN_FLIGHT")
      assertEquals(matchDraftStatus, "ocr_failed")

  test("claimDue quarantines semantically parseable but non-canonical wire payloads"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-invalid-noncanonical")
    val outboxId = OcrQueueOutboxDraft.idForJob(jobId)
    val nonCanonicalPayload = OcrWorkerJobMessageV2.fieldsAsJson(workerMessage(jobId)).mapObject(
      _.add("enqueuedAt", Json.fromString("2026-05-08T15:00:00.000Z"))
    )
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-noncanonical"),
        now.minusSeconds(60),
      )
      _ <- insertOutboxWithPayload(
        id = outboxId,
        jobId = jobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(60),
        payloadJson = nonCanonicalPayload,
      )
      claim <- repo.claimDue(1, now, claimUntil)
        .map(claims => invalidClaim(claims.headOption.getOrElse(fail("claim missing"))))
      failed <- repo.failInvalidClaim(claim, now.plusSeconds(1))
    yield
      assertEquals(claim.id, outboxId)
      assert(failed)

  test("claimDue quarantines a non-canonical outbox identity"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-invalid-id")
    val nonCanonicalOutboxId = "wrong-outbox-id"
    for
      _ <- insertOcrRows(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-id"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = nonCanonicalOutboxId,
        jobId = jobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(60),
      )
      claim <- repo.claimDue(1, now, claimUntil)
        .map(claims => invalidClaim(claims.headOption.getOrElse(fail("claim missing"))))
      failed <- repo.failInvalidClaim(claim, now.plusSeconds(1))
    yield
      assertEquals(claim.id, nonCanonicalOutboxId)
      assert(failed)

  test("invalid claims converge outbox rows while preserving running and PEL owners"):
    val corruptJobId = OcrJobId.unsafeFromString("job-outbox-invalid-corrupt")
    val legacyJobId = OcrJobId.unsafeFromString("job-outbox-invalid-legacy")
    val pelJobId = OcrJobId.unsafeFromString("job-outbox-invalid-pel")
    val runningJobId = OcrJobId.unsafeFromString("job-outbox-invalid-running")
    val payloadJobId = OcrJobId.unsafeFromString("job-outbox-invalid-other-payload")
    val corruptOutboxId = OcrQueueOutboxDraft.idForJob(corruptJobId)
    val legacyOutboxId = OcrQueueOutboxDraft.idForJob(legacyJobId)
    val pelOutboxId = OcrQueueOutboxDraft.idForJob(pelJobId)
    val runningOutboxId = OcrQueueOutboxDraft.idForJob(runningJobId)
    for
      _ <- insertOcrRows(
        corruptJobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-corrupt"),
        now.minusSeconds(150),
      )
      _ <- insertOcrRowsWithContract(
        legacyJobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-legacy"),
        now.minusSeconds(120),
        queueSchemaVersion = 1.toShort,
        attemptCount = 0,
      )
      _ <- insertOcrRowsWithContract(
        pelJobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-pel"),
        now.minusSeconds(90),
        queueSchemaVersion = 2.toShort,
        attemptCount = 1,
      )
      _ <- insertOcrRows(
        runningJobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-running"),
        now.minusSeconds(60),
      )
      _ <- insertOutbox(
        id = corruptOutboxId,
        jobId = corruptJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(3),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(150),
      )
      _ <- insertOutboxWithSchema(
        id = legacyOutboxId,
        jobId = legacyJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(2),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(120),
        schemaVersion = 1.toShort,
      )
      _ <- insertOutbox(
        id = pelOutboxId,
        jobId = pelJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(2),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(90),
      )
      _ <- insertOutboxWithPayload(
        id = runningOutboxId,
        jobId = runningJobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = now.minusSeconds(1),
        claimExpiresAt = None,
        createdAt = now.minusSeconds(60),
        payloadJson = OcrWorkerJobMessageV2.fieldsAsJson(workerMessage(payloadJobId)),
      )
      _ <- sql"UPDATE ocr_jobs SET status = 'running' WHERE id = $runningJobId".update.run
        .transact(transactor)
      _ <- sql"UPDATE ocr_jobs SET status = 'corrupt' WHERE id = $corruptJobId".update.run
        .transact(transactor)
      claims <- repo.claimDue(limit = 4, now = now, claimUntil = claimUntil)
      invalids = claims.map(invalidClaim)
      results <- invalids.traverse(repo.failInvalidClaim(_, now.plusSeconds(1)))
      outboxStates <- sql"""
        SELECT id, status
        FROM ocr_queue_outbox
        WHERE id IN ($corruptOutboxId, $legacyOutboxId, $pelOutboxId, $runningOutboxId)
        ORDER BY id
      """.query[(String, String)].to[List].transact(transactor)
      jobStates <- sql"""
        SELECT id, status, failure_code
        FROM ocr_jobs
        WHERE id IN ($corruptJobId, $legacyJobId, $pelJobId, $runningJobId)
        ORDER BY id
      """.query[(String, String, Option[String])].to[List].transact(transactor)
    yield
      assertEquals(
        invalids.map(_.id),
        List(corruptOutboxId, legacyOutboxId, pelOutboxId, runningOutboxId),
      )
      assertEquals(results, List(true, true, true, true))
      assertEquals(
        outboxStates,
        List(
          (corruptOutboxId, "FAILED"),
          (legacyOutboxId, "FAILED"),
          (pelOutboxId, "FAILED"),
          (runningOutboxId, "FAILED"),
        ),
      )
      assertEquals(
        jobStates,
        List(
          (corruptJobId.value, "corrupt", None),
          (legacyJobId.value, "failed", Some("QUEUE_FAILURE")),
          (pelJobId.value, "queued", None),
          (runningJobId.value, "running", None),
        ),
      )

  test("failInvalidClaim rejects a stale claim token after reclamation"):
    val jobId = OcrJobId.unsafeFromString("job-outbox-invalid-stale-token")
    val outboxId = OcrQueueOutboxDraft.idForJob(jobId)
    val firstClaimAt = now.minusSeconds(120)
    val firstClaimUntil = now.minusSeconds(1)
    for
      _ <- insertOcrRowsWithContract(
        jobId,
        OcrDraftId.unsafeFromString("draft-outbox-invalid-stale-token"),
        now.minusSeconds(180),
        queueSchemaVersion = 1.toShort,
        attemptCount = 0,
      )
      _ <- insertOutboxWithSchema(
        id = outboxId,
        jobId = jobId,
        status = OcrQueueOutboxStatus.Pending,
        attemptCount = 0,
        nextAttemptAt = firstClaimAt,
        claimExpiresAt = None,
        createdAt = now.minusSeconds(180),
        schemaVersion = 1.toShort,
      )
      first <- repo.claimDue(1, firstClaimAt, firstClaimUntil)
        .map(claims => invalidClaim(claims.headOption.getOrElse(fail("first claim missing"))))
      second <- repo.claimDue(1, now, claimUntil)
        .map(claims => invalidClaim(claims.headOption.getOrElse(fail("second claim missing"))))
      staleFailed <- repo.failInvalidClaim(first, now.plusSeconds(1))
      stateAfterStale <- sql"""
        SELECT q.status, j.status
        FROM ocr_queue_outbox q
        JOIN ocr_jobs j ON j.id = q.job_id
        WHERE q.id = $outboxId
      """.query[(String, String)].unique.transact(transactor)
      currentFailed <- repo.failInvalidClaim(second, now.plusSeconds(2))
    yield
      assertNotEquals(first.claimToken, second.claimToken)
      assertEquals(staleFailed, false)
      assertEquals(stateAfterStale, ("IN_FLIGHT", "queued"))
      assertEquals(currentFailed, true)
