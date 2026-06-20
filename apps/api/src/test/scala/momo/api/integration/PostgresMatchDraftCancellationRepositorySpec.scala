package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.{ImageId, MatchDraftId}
import momo.api.repositories.MatchDraftCancellationResult
import momo.api.repositories.postgres.PostgresMatchDraftCancellationRepository

final class PostgresMatchDraftCancellationRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-20T10:05:00Z")
  private val draftId = MatchDraftId.unsafeFromString("match-draft-cancel-atomic")
  private val imageId = ImageId.unsafeFromString("image-cancel-atomic")

  private def repo = PostgresMatchDraftCancellationRepository[IO](transactor)

  test("cancelDraftAndQueuedOcrJobs deletes the draft and cancels queued OCR jobs atomically"):
    for
      _ <- insertOcrDraft("ocr-draft-cancel-atomic", "ocr-job-cancel-atomic")
      _ <- insertOcrJob("ocr-job-cancel-atomic", "ocr-draft-cancel-atomic", imageId.value)
      _ <- insertMatchDraft(
        id = draftId.value,
        status = "ocr_running",
        totalAssetsImageId = Some(imageId.value),
        totalAssetsDraftId = Some("ocr-draft-cancel-atomic"),
      )
      result <- repo.cancelDraftAndQueuedOcrJobs(draftId, now)
      draftExists <- matchDraftExists(draftId.value)
      jobStatus <- ocrJobStatus("ocr-job-cancel-atomic")
    yield
      assertEquals(result, MatchDraftCancellationResult.Cancelled(List(imageId)))
      assertEquals(draftExists, false)
      assertEquals(jobStatus, "cancelled")

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
end PostgresMatchDraftCancellationRepositorySpec
