package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ids.{OcrDraftId, OcrJobId}
import momo.api.repositories.postgres.PostgresOcrJobsRepository

final class PostgresOcrJobsRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-14T10:00:00Z")

  private def repo = PostgresOcrJobsRepository[IO](transactor)

  test("countActive counts queued and running jobs only"):
    for
      _ <- insertOcrDraft("draft-count-queued", "job-count-queued")
      _ <- insertOcrDraft("draft-count-running", "job-count-running")
      _ <- insertOcrDraft("draft-count-succeeded", "job-count-succeeded")
      _ <- insertOcrJob("job-count-queued", "draft-count-queued", "image-count-queued", "queued")
      _ <-
        insertOcrJob("job-count-running", "draft-count-running", "image-count-running", "running")
      _ <- insertOcrJob(
        "job-count-succeeded",
        "draft-count-succeeded",
        "image-count-succeeded",
        "succeeded",
      )
      active <- repo.countActive
    yield assertEquals(active, 2L)

  test("cancelQueued marks the queued job cancelled and syncs the attached draft to OCR failed"):
    for
      _ <- insertOcrDraft("draft-cancel-one", "job-cancel-one")
      _ <- insertMatchDraft(
        id = "match-draft-cancel-one",
        status = "ocr_running",
        totalAssetsDraftId = Some("draft-cancel-one"),
        revenueDraftId = None,
      )
      _ <- insertOcrJob(
        id = "job-cancel-one",
        draftId = "draft-cancel-one",
        imageId = "image-cancel-one",
        status = "queued",
      )
      cancelled <- repo.cancelQueued(OcrJobId.unsafeFromString("job-cancel-one"), now)
      row <- sql"""
        SELECT j.status, j.finished_at, md.status
        FROM ocr_jobs j
        JOIN match_drafts md ON md.id = 'match-draft-cancel-one'
        WHERE j.id = 'job-cancel-one'
      """.query[(String, Instant, String)].unique.transact(transactor)
    yield
      assertEquals(cancelled, true)
      assertEquals(row, ("cancelled", now, "ocr_failed"))

  test("cancelQueued keeps the draft running while another attached slot is still queued"):
    for
      _ <- insertOcrDraft("draft-cancel-pending-a", "job-cancel-pending-a")
      _ <- insertOcrDraft("draft-cancel-pending-b", "job-cancel-pending-b")
      _ <- insertMatchDraft(
        id = "match-draft-cancel-pending",
        status = "ocr_running",
        totalAssetsDraftId = Some("draft-cancel-pending-a"),
        revenueDraftId = Some("draft-cancel-pending-b"),
      )
      _ <- insertOcrJob(
        id = "job-cancel-pending-a",
        draftId = "draft-cancel-pending-a",
        imageId = "image-cancel-pending-a",
        status = "queued",
      )
      _ <- insertOcrJob(
        id = "job-cancel-pending-b",
        draftId = "draft-cancel-pending-b",
        imageId = "image-cancel-pending-b",
        status = "queued",
      )
      cancelled <- repo.cancelQueued(OcrJobId.unsafeFromString("job-cancel-pending-a"), now)
      draftStatus <- sql"""
        SELECT status FROM match_drafts WHERE id = 'match-draft-cancel-pending'
      """.query[String].unique.transact(transactor)
    yield
      assertEquals(cancelled, true)
      assertEquals(draftStatus, "ocr_running")

  test("cancelQueuedByDraftIds cancels queued jobs for discarded draft slots"):
    for
      _ <- insertOcrDraft("draft-cancel-bulk-a", "job-cancel-bulk-a")
      _ <- insertOcrDraft("draft-cancel-bulk-b", "job-cancel-bulk-b")
      _ <- insertOcrDraft("draft-cancel-bulk-running", "job-cancel-bulk-running")
      _ <- insertOcrJob(
        id = "job-cancel-bulk-a",
        draftId = "draft-cancel-bulk-a",
        imageId = "image-cancel-bulk-a",
        status = "queued",
      )
      _ <- insertOcrJob(
        id = "job-cancel-bulk-b",
        draftId = "draft-cancel-bulk-b",
        imageId = "image-cancel-bulk-b",
        status = "queued",
      )
      _ <- insertOcrJob(
        id = "job-cancel-bulk-running",
        draftId = "draft-cancel-bulk-running",
        imageId = "image-cancel-bulk-running",
        status = "running",
      )
      cancelled <- repo.cancelQueuedByDraftIds(
        List(
          OcrDraftId.unsafeFromString("draft-cancel-bulk-a"),
          OcrDraftId.unsafeFromString("draft-cancel-bulk-b"),
          OcrDraftId.unsafeFromString("draft-cancel-bulk-running"),
        ),
        now,
      )
      statuses <- sql"""
        SELECT id, status
        FROM ocr_jobs
        WHERE id IN (
          'job-cancel-bulk-a',
          'job-cancel-bulk-b',
          'job-cancel-bulk-running'
        )
        ORDER BY id
      """.query[(String, String)].to[List].transact(transactor)
    yield
      assertEquals(cancelled, 2)
      assertEquals(
        statuses,
        List(
          "job-cancel-bulk-a" -> "cancelled",
          "job-cancel-bulk-b" -> "cancelled",
          "job-cancel-bulk-running" -> "running",
        ),
      )

  private def insertOcrDraft(id: String, jobId: String): IO[Int] = sql"""
    INSERT INTO ocr_drafts (
      id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
      created_at, updated_at
    ) VALUES (
      $id, $jobId, 'total_assets', '{}', '[]', '{}', $now, $now
    )
  """.update.run.transact(transactor)

  private def insertOcrJob(id: String, draftId: String, imageId: String, status: String): IO[Int] =
    sql"""
    INSERT INTO ocr_jobs (
      id, draft_id, image_id, image_path, requested_screen_type, status, attempt_count,
      created_at, updated_at
    ) VALUES (
      $id, $draftId, $imageId, ${s"/tmp/$imageId.png"}, 'total_assets', $status, 0, $now, $now
    )
  """.update.run.transact(transactor)

  private def insertMatchDraft(
      id: String,
      status: String,
      totalAssetsDraftId: Option[String],
      revenueDraftId: Option[String],
  ): IO[Int] = sql"""
    INSERT INTO match_drafts (
      id, created_by_account_id, created_by_member_id, status,
      total_assets_draft_id, revenue_draft_id, created_at, updated_at
    ) VALUES (
      $id, 'account_ponta', 'member_ponta', $status,
      $totalAssetsDraftId, $revenueDraftId, $now, $now
    )
  """.update.run.transact(transactor)
end PostgresOcrJobsRepositorySpec
