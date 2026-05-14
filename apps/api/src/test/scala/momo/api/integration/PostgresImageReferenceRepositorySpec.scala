package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.ids.ImageId
import momo.api.repositories.postgres.PostgresImageReferenceRepository

final class PostgresImageReferenceRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-14T12:00:00Z")

  private def repo = PostgresImageReferenceRepository[IO](transactor)

  test("referencedImageIds protects active jobs and non-terminal draft images only"):
    for
      _ <- insertOcrDraft("draft-active-image", "job-active-image")
      _ <- insertOcrDraft("draft-completed-image", "job-completed-image")
      _ <- insertOcrJob("job-active-image", "draft-active-image", "image-active-job", "queued")
      _ <- insertOcrJob("job-completed-image", "draft-completed-image", "image-completed-job", "succeeded")
      _ <- insertMatchDraft("match-draft-active-image", "draft_ready", Some("image-active-draft"))
      _ <- insertMatchDraft("match-draft-terminal-image", "cancelled", Some("image-terminal-draft"))
      referenced <- repo.referencedImageIds
    yield
      assert(referenced.contains(ImageId.unsafeFromString("image-active-job")))
      assert(referenced.contains(ImageId.unsafeFromString("image-active-draft")))
      assert(!referenced.contains(ImageId.unsafeFromString("image-completed-job")))
      assert(!referenced.contains(ImageId.unsafeFromString("image-terminal-draft")))

  private def insertOcrDraft(id: String, jobId: String): IO[Int] = sql"""
    INSERT INTO ocr_drafts (
      id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
      created_at, updated_at
    ) VALUES (
      $id, $jobId, 'total_assets', '{}', '[]', '{}', $now, $now
    )
  """.update.run.transact(transactor)

  private def insertOcrJob(
      id: String,
      draftId: String,
      imageId: String,
      status: String,
  ): IO[Int] = sql"""
    INSERT INTO ocr_jobs (
      id, draft_id, image_id, image_path, requested_screen_type, detected_screen_type, status,
      attempt_count, started_at, finished_at, duration_ms, created_at, updated_at
    ) VALUES (
      $id, $draftId, $imageId, ${s"/tmp/$imageId.png"}, 'total_assets',
      CASE WHEN $status = 'succeeded' THEN 'total_assets' ELSE NULL END,
      $status, 0,
      CASE WHEN $status = 'succeeded' THEN $now ELSE NULL END,
      CASE WHEN $status = 'succeeded' THEN $now ELSE NULL END,
      CASE WHEN $status = 'succeeded' THEN 1 ELSE NULL END,
      $now, $now
    )
  """.update.run.transact(transactor)

  private def insertMatchDraft(id: String, status: String, imageId: Option[String]): IO[Int] =
    sql"""
      INSERT INTO match_drafts (
        id, created_by_account_id, created_by_member_id, status,
        total_assets_image_id, created_at, updated_at
      ) VALUES (
        $id, 'account_ponta', 'member_ponta', $status, $imageId, $now, $now
      )
    """.update.run.transact(transactor)
end PostgresImageReferenceRepositorySpec
