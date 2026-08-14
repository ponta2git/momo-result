package momo.api.integration
import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Deferred, IO, Resource}
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import io.circe.Json

import momo.api.adapters.postgres.{PostgresOcrJobCreationStore, PostgresSourceImagesRepository}
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.ports.storage.{Sha256Hex, SourceImageIdempotencyHash, SourceImageObjectKey}
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{
  OcrJobCreationPlan,
  OcrJobCreationStore,
  OcrJobDraftAttachment,
  OcrQueueDispatchIntent,
  SourceImageDeleteResult,
  SourceImageQuota,
  SourceImageReservation,
  SourceImageStatus
}
import momo.api.testing.JsonSchemaAssertions

final class PostgresOcrJobCreationStoreSpec extends IntegrationSuite with JsonSchemaAssertions:

  private val now = Instant.parse("2026-05-08T10:00:00Z")
  private val jobId = OcrJobId.unsafeFromString("job-outbox-1")
  private val draftId = OcrDraftId.unsafeFromString("draft-outbox-1")
  private val imageId = ImageId.unsafeFromString("img-outbox-1")
  private val imageSha256 = "a" * 64
  private val imageObjectKey = SourceImageObjectKey.forImage(imageId, "png")
    .fold(fail(_), identity)

  private def repo = PostgresOcrJobCreationStore[IO](transactor)
  private def sourceImages = PostgresSourceImagesRepository[IO](transactor)

  private def draft: OcrDraft = OcrDraft(
    id = draftId,
    jobId = jobId,
    requestedScreenType = ScreenType.TotalAssets,
    detectedScreenType = None,
    profileId = None,
    payloadJson = "{}",
    warningsJson = "[]",
    timingsMsJson = "{}",
    createdAt = now,
    updatedAt = now,
  )

  private def job: OcrJob = OcrJob.Queued(
    id = jobId,
    draftId = draftId,
    imageId = imageId,
    imageLocation = StoredImageLocation.unsafeFromString(imageObjectKey.value),
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = now,
    updatedAt = now,
  )

  private def enqueueRequest: OcrJobEnqueueRequest = OcrJobEnqueueRequest(
    jobId = jobId,
    draftId = draftId,
    imageId = imageId,
    imageLocation = StoredImageLocation.unsafeFromString(imageObjectKey.value),
    imageSha256 = imageSha256,
    imageByteLength = 128,
    imageMediaType = "image/png",
    requestedScreenType = ScreenType.TotalAssets,
    attempt = 1,
    enqueuedAt = now,
    hints = OcrJobHints(
      gameTitle = Some("桃鉄2"),
      layoutFamily = Some("momotetsu_2"),
      knownPlayerAliases =
        List(PlayerAliasHint(MemberId.unsafeFromString("member-ponta"), List("ぽんた", "ぽんた社長"))),
      computerPlayerAliases = List("さくま"),
    ),
    requestId = Some("req-outbox-1"),
  )

  test("store inserts OCR records and durable outbox intent in one transaction"):
    for
      result <- store(plan(job, draft, None, activeJobLimit = 12))
      row <- sql"""
        SELECT status, attempt_count, stream_payload->>'jobId', stream_payload->>'requestId',
               stream_payload
        FROM ocr_queue_outbox
        WHERE job_id = ${jobId.value}
      """.query[(String, Int, String, String, Json)].unique.transact(transactor)
    yield
      assertEquals(result, Right(()))
      assertEquals(row._1, "PENDING")
      assertEquals(row._2, 0)
      assertEquals(row._3, jobId.value)
      assertEquals(row._4, "req-outbox-1")
      assertOcrWorkerJobMessageV2SchemaValid(row._5)

  test("store rejects over the active job limit before inserting related rows"):
    for
      result <- store(plan(job, draft, None, activeJobLimit = 0))
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assertActiveLimit(result, 0)
      assertEquals(counts, (0L, 0L, 0L))

  test("store rolls back OCR records when match draft attachment fails"):
    val attachment = OcrJobDraftAttachment(
      draftId = MatchDraftId.unsafeFromString("missing-match-draft"),
      screenType = ScreenType.TotalAssets,
      sourceImageId = imageId,
      ocrDraftId = draftId,
      updatedAt = now,
    )
    for
      result <- store(plan(job, draft, Some(attachment), activeJobLimit = 12))
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assertAttachFailed(result, attachment.draftId)
      assertEquals(counts, (0L, 0L, 0L))

  test("store rejects invalid draft JSON before inserting related rows"):
    val invalidDraft = draft.copy(payloadJson = "{")
    for
      result <- store(plan(job, invalidDraft, None, activeJobLimit = 12)).attempt
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assert(result.left.exists(_.getMessage.contains("payloadJson")))
      assertEquals(counts, (0L, 0L, 0L))

  test("store rejects queue metadata that disagrees with the locked source image"):
    val valid = plan(job, draft, None, activeJobLimit = 12)
    val invalid = valid.copy(queueDispatch =
      valid.queueDispatch.copy(
        enqueueRequest = valid.queueDispatch.enqueueRequest.copy(imageSha256 = "b" * 64)
      )
    )

    for
      result <- store(invalid)
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assertEquals(result, Left(OcrJobCreationRejection.InvalidPlan))
      assertEquals(counts, (0L, 0L, 0L))

  test("store rejects an attachment that names a different source image"):
    val inconsistentAttachment = OcrJobDraftAttachment(
      draftId = MatchDraftId.unsafeFromString("missing-match-draft"),
      screenType = ScreenType.TotalAssets,
      sourceImageId = ImageId.unsafeFromString("different-source-image"),
      ocrDraftId = draftId,
      updatedAt = now,
    )

    store(plan(job, draft, Some(inconsistentAttachment), activeJobLimit = 12)).map(result =>
      assertEquals(result, Left(OcrJobCreationRejection.InvalidPlan))
    )

  test("store waits for a concurrent deletion transition and rejects its committed state"):
    for
      _ <- prepareSourceImage
      deletionLocked <- Deferred[IO, Unit]
      releaseDeletion <- Deferred[IO, Unit]
      deletion <- holdDeletionTransition(deletionLocked, releaseDeletion).start
      _ <- deletionLocked.get
      resultReady <- Deferred[IO, OcrJobCreationStore.OcrJobCreationResult]
      creation <- repo.store(plan(job, draft, None, activeJobLimit = 12))
        .flatTap(resultReady.complete).start
      _ <- IO.sleep(100.millis)
      beforeCommit <- resultReady.tryGet
      _ <- releaseDeletion.complete(())
      result <- creation.joinWithNever
      _ <- deletion.joinWithNever
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assertEquals(beforeCommit, None)
      assertSourceImageUnavailable(result, imageId)
      assertEquals(counts, (0L, 0L, 0L))

  test("orphan deletion waits for the source lock and observes the committed OCR reference"):
    for
      _ <- prepareSourceImage
      sourceLocked <- Deferred[IO, Unit]
      releaseJob <- Deferred[IO, Unit]
      jobTransaction <- holdOcrReferenceTransaction(sourceLocked, releaseJob).start
      _ <- sourceLocked.get
      deletionReady <- Deferred[IO, SourceImageDeleteResult]
      deletionFiber <- sourceImages.beginDeleteUnreferenced(imageId, now.plusSeconds(1))
        .flatTap(deletionReady.complete).start
      _ <- IO.sleep(100.millis)
      beforeCommit <- deletionReady.tryGet
      _ <- releaseJob.complete(())
      deletion <- deletionFiber.joinWithNever
      _ <- jobTransaction.joinWithNever
    yield
      assertEquals(beforeCommit, None)
      assertEquals(deletion, SourceImageDeleteResult.NotReady(SourceImageStatus.Available))

  private def store(
      creationPlan: OcrJobCreationPlan
  ): IO[OcrJobCreationStore.OcrJobCreationResult] = prepareSourceImage *> repo.store(creationPlan)

  private def prepareSourceImage: IO[Unit] =
    val reservation = SourceImageReservation(
      id = imageId,
      ownerAccountId = AccountId.unsafeFromString("account_ponta"),
      objectKey = imageObjectKey,
      idempotencyKeyHash = SourceImageIdempotencyHash.uniqueFor(imageId),
      mediaType = "image/png",
      sizeBytes = 128,
      sha256 = Sha256Hex.fromString(imageSha256).fold(fail(_), identity),
      width = 1920,
      height = 1080,
      now = now,
    )
    sourceImages.reserveWithinQuota(reservation, SourceImageQuota(1000, Long.MaxValue)) *>
      sourceImages.markAvailable(imageId, None, now).void

  private def holdDeletionTransition(
      locked: Deferred[IO, Unit],
      release: Deferred[IO, Unit],
  ): IO[Unit] = Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use {
    connection =>
      val transition = IO.blocking {
        connection.setAutoCommit(false)
        val statement = connection.prepareStatement(
          """UPDATE source_images
            |SET status = 'DELETE_PENDING', delete_pending_at = ?, updated_at = ?
            |WHERE id = ? AND status = 'AVAILABLE'""".stripMargin
        )
        try
          statement.setTimestamp(1, java.sql.Timestamp.from(now.plusSeconds(1)))
          statement.setTimestamp(2, java.sql.Timestamp.from(now.plusSeconds(1)))
          statement.setString(3, imageId.value)
          if statement.executeUpdate() != 1 then
            fail("test deletion transition did not lock one image")
        finally statement.close()
      }
      (transition *> locked.complete(()) *> release.get *> IO.blocking(connection.commit()))
        .onError(_ => IO.blocking(connection.rollback()))
  }

  private def holdOcrReferenceTransaction(
      locked: Deferred[IO, Unit],
      release: Deferred[IO, Unit],
  ): IO[Unit] = Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use {
    connection =>
      val insertReference = IO.blocking {
        connection.setAutoCommit(false)
        val lock = connection.prepareStatement(
          "SELECT status FROM source_images WHERE id = ? FOR UPDATE"
        )
        try
          lock.setString(1, imageId.value)
          val rows = lock.executeQuery()
          try
            if !rows.next() || rows.getString(1) != SourceImageStatus.Available.wire then
              fail("test source image was not AVAILABLE")
          finally rows.close()
        finally lock.close()

        val insert = connection.prepareStatement(
          """INSERT INTO ocr_jobs (
            |  id, draft_id, image_id, source_image_id, queue_schema_version,
            |  requested_screen_type, status, attempt_count, created_at, updated_at
            |) VALUES (?, ?, ?, ?, 2, 'total_assets', 'queued', 0, ?, ?)""".stripMargin
        )
        try
          insert.setString(1, jobId.value)
          insert.setString(2, draftId.value)
          insert.setString(3, imageId.value)
          insert.setString(4, imageId.value)
          insert.setTimestamp(5, java.sql.Timestamp.from(now))
          insert.setTimestamp(6, java.sql.Timestamp.from(now))
          if insert.executeUpdate() != 1 then
            fail("test OCR reference was not inserted")
        finally insert.close()
      }
      (insertReference *> locked.complete(()) *> release.get *> IO.blocking(connection.commit()))
        .onError(_ => IO.blocking(connection.rollback()))
  }

  private def assertActiveLimit(
      result: OcrJobCreationStore.OcrJobCreationResult,
      limit: Int,
  ): Unit = result match
    case Left(OcrJobCreationRejection.ActiveJobLimitExceeded(actualLimit)) =>
      assertEquals(actualLimit, limit)
    case other => fail(s"expected active limit rejection, got $other")

  private def assertAttachFailed(
      result: OcrJobCreationStore.OcrJobCreationResult,
      draftId: MatchDraftId,
  ): Unit = result match
    case Left(OcrJobCreationRejection.MatchDraftAttachmentRejected(actualDraftId)) =>
      assertEquals(actualDraftId, draftId)
    case other => fail(s"expected match draft attachment rejection, got $other")

  private def assertSourceImageUnavailable(
      result: OcrJobCreationStore.OcrJobCreationResult,
      expectedImageId: ImageId,
  ): Unit = result match
    case Left(OcrJobCreationRejection.SourceImageUnavailable(actualImageId)) =>
      assertEquals(actualImageId, expectedImageId)
    case other => fail(s"expected source image rejection, got $other")

  private def plan(
      job: OcrJob,
      draft: OcrDraft,
      attachment: Option[OcrJobDraftAttachment],
      activeJobLimit: Int,
  ): OcrJobCreationPlan =
    val dispatch = OcrQueueDispatchIntent(
      enqueueRequest = enqueueRequest,
      jobId = job.id,
      draftId = draft.id,
      matchDraftId = attachment.map(_.draftId),
      createdAt = now,
    )
    OcrJobCreationPlan(
      draft = draft,
      job = job,
      matchDraftAttachment = attachment,
      queueDispatch = dispatch,
      activeJobLimit = activeJobLimit,
    )
