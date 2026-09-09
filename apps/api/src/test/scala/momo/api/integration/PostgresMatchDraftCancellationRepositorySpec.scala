package momo.api.integration

import java.time.Instant

import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.{
  PostgresMatchDraftCancellation,
  PostgresMatchDraftCancellationRepository
}
import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.{ImageId, MatchDraftId}
import momo.api.repositories.MatchDraftCancellationResult

final class PostgresMatchDraftCancellationRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-20T10:05:00Z")
  private val draftId = MatchDraftId.unsafeFromString("match-draft-cancel-atomic")
  private val imageId = ImageId.unsafeFromString("image-cancel-atomic")

  private def repo = PostgresMatchDraftCancellationRepository[IO](transactor)

  test("cancelDraftAndQueuedOcrJobs deletes the draft and cancels queued OCR jobs atomically"):
    for
      _ <- insertSourceImage(imageId)
      _ <- insertOcrDraft("ocr-draft-cancel-atomic", "ocr-job-cancel-atomic")
      _ <- insertOcrJob("ocr-job-cancel-atomic", "ocr-draft-cancel-atomic", imageId.value)
      _ <- insertMatchDraft(
        id = draftId.value,
        status = "ocr_running",
        totalAssetsImageId = Some(imageId.value),
        totalAssetsDraftId = Some("ocr-draft-cancel-atomic"),
      )
      _ <- ResultNotificationFixture.seed("match_draft", draftId.value, now).transact(transactor)
      result <- repo.cancelDraftAndQueuedOcrJobs(draftId, now)
      draftExists <- matchDraftExists(draftId.value)
      jobStatus <- ocrJobStatus("ocr-job-cancel-atomic")
      sourceStatus <- sourceImageStatus(imageId)
      notification <- ResultNotificationFixture.state(transactor)
    yield
      assertEquals(result, MatchDraftCancellationResult.Cancelled(List(imageId)))
      assertEquals(draftExists, false)
      assertEquals(jobStatus, "cancelled")
      assertEquals(sourceStatus, "DELETE_PENDING")
      assertEquals(notification, ResultNotificationFixture.cancelled("draft_unavailable"))

  test("cancelDraftAndQueuedOcrJobs keeps terminal drafts and their OCR jobs unchanged"):
    for
      _ <- insertOcrDraft("ocr-draft-cancel-terminal", "ocr-job-cancel-terminal")
      _ <- insertOcrJob("ocr-job-cancel-terminal", "ocr-draft-cancel-terminal", imageId.value)
      _ <- insertMatchDraft(
        id = draftId.value,
        status = "cancelled",
        totalAssetsImageId = Some(imageId.value),
        totalAssetsDraftId = Some("ocr-draft-cancel-terminal"),
      )
      result <- repo.cancelDraftAndQueuedOcrJobs(draftId, now)
      draftExists <- matchDraftExists(draftId.value)
      jobStatus <- ocrJobStatus("ocr-job-cancel-terminal")
    yield
      assertEquals(result, MatchDraftCancellationResult.NotCancellable(MatchDraftStatus.Cancelled))
      assertEquals(draftExists, true)
      assertEquals(jobStatus, "queued")

  test("a failure after cancellation rolls back both the source draft and notification parts"):
    for
      _ <- insertMatchDraft(draftId.value, "draft_ready", None, None)
      _ <- ResultNotificationFixture.seed("match_draft", draftId.value, now).transact(transactor)
      before <- ResultNotificationFixture.state(transactor)
      result <-
      (PostgresMatchDraftCancellation.cancelDraftAndQueuedOcrJobs(draftId, now) *>
        new IllegalStateException("abort source command").raiseError[ConnectionIO, Unit])
        .transact(transactor).attempt
      exists <- matchDraftExists(draftId.value)
      after <- ResultNotificationFixture.state(transactor)
    yield
      assertEquals(result.left.map(_.getMessage), Left("abort source command"))
      assertEquals(exists, true)
      assertEquals(after, before)

  test(
    "source deletion remains uncommitted while its notification cancellation waits for the gate"
  ):
    for
      _ <- insertMatchDraft(draftId.value, "draft_ready", None, None)
      _ <- ResultNotificationFixture.seed("match_draft", draftId.value, now).transact(transactor)
      locked <- Deferred[IO, Int]
      release <- Deferred[IO, Unit]
      holder <- holdNotificationGate(locked, release).start
      pid <- locked.get
      cancellation <- repo.cancelDraftAndQueuedOcrJobs(draftId, now).start
      before <- (awaitBackendBlockedBy(pid) *> matchDraftExists(draftId.value))
        .guarantee(release.complete(()).void)
      result <- cancellation.joinWithNever
      _ <- holder.joinWithNever
      after <- matchDraftExists(draftId.value)
      notification <- ResultNotificationFixture.state(transactor)
    yield
      assertEquals(before, true)
      assertEquals(after, false)
      assertEquals(result, MatchDraftCancellationResult.Cancelled(Nil))
      assertEquals(notification, ResultNotificationFixture.cancelled("draft_unavailable"))

  private def holdNotificationGate(
      locked: Deferred[IO, Int],
      release: Deferred[IO, Unit]
  ): IO[Unit] =
    Resource.fromAutoCloseable(IO.blocking(dataSource.getConnection)).use { connection =>
      val acquire = IO.blocking {
        connection.setAutoCommit(false)
        val statement = connection.createStatement()
        try
          val rows =
            statement.executeQuery("SELECT pg_advisory_xact_lock(19790514, 1), pg_backend_pid()")
          try
            if !rows.next() then fail("gate fixture returned no backend")
            rows.getInt(2)
          finally rows.close()
        finally statement.close()
      }
      (acquire.flatMap(locked.complete) *> release.get *> IO.blocking(connection.commit()))
        .onError(_ => IO.blocking(connection.rollback()))
    }

  private def insertOcrDraft(id: String, jobId: String): IO[Int] = sql"""
    INSERT INTO ocr_drafts (
      id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
      created_at, updated_at
    ) VALUES (
      $id, $jobId, 'total_assets', '{}', '[]', '{}', $now, $now
    )
  """.update.run.transact(transactor)

  private def insertOcrJob(id: String, draftId: String, imageId: String): IO[Int] = sql"""
    INSERT INTO ocr_jobs (
      id, draft_id, image_id, image_path, requested_screen_type, status, attempt_count,
      created_at, updated_at
    ) VALUES (
      $id, $draftId, $imageId, ${s"/tmp/$imageId.png"}, 'total_assets', 'queued', 0, $now, $now
    )
  """.update.run.transact(transactor)

  private def insertMatchDraft(
      id: String,
      status: String,
      totalAssetsImageId: Option[String],
      totalAssetsDraftId: Option[String],
  ): IO[Int] = sql"""
    INSERT INTO match_drafts (
      id, created_by_account_id, created_by_member_id, status,
      total_assets_image_id, total_assets_draft_id, created_at, updated_at
    ) VALUES (
      $id, 'account_ponta', 'member_ponta', $status,
      $totalAssetsImageId, $totalAssetsDraftId, $now, $now
    )
  """.update.run.transact(transactor)

  private def matchDraftExists(id: String): IO[Boolean] = sql"""
    SELECT EXISTS(SELECT 1 FROM match_drafts WHERE id = $id)
  """.query[Boolean].unique.transact(transactor)

  private def ocrJobStatus(id: String): IO[String] = sql"""
    SELECT status FROM ocr_jobs WHERE id = $id
  """.query[String].unique.transact(transactor)

  private def insertSourceImage(id: ImageId): IO[Int] = sql"""
    INSERT INTO source_images (
      id, owner_account_id, object_key, idempotency_key_hash, status,
      media_type, byte_length, sha256_hex, width, height, available_at, created_at, updated_at
    ) VALUES (
      $id, 'account_ponta', ${s"source-images/${id.value}.png"}, ${"a" * 64}, 'AVAILABLE',
      'image/png', 128, ${"b" * 64}, 1920, 1080, $now, $now, $now
    )
  """.update.run.transact(transactor)

  private def sourceImageStatus(id: ImageId): IO[String] = sql"""
    SELECT status FROM source_images WHERE id = $id
  """.query[String].unique.transact(transactor)
end PostgresMatchDraftCancellationRepositorySpec
