package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.repositories.postgres.PostgresOcrJobMaintenanceRepository

final class PostgresOcrJobMaintenanceRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-08T12:00:00Z")

  private def repo = PostgresOcrJobMaintenanceRepository[IO](transactor)

  test("failStaleJobs marks stale queued OCR jobs and their draft failed"):
    val staleCreatedAt = now.minusSeconds(600)
    for
      _ <- sql"""
        INSERT INTO ocr_drafts (
          id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
          created_at, updated_at
        ) VALUES (
          'draft-stale-maintenance', 'job-stale-maintenance', 'total_assets', '{}', '[]', '{}',
          $staleCreatedAt, $staleCreatedAt
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status, total_assets_draft_id,
          created_at, updated_at
        ) VALUES (
          'match-draft-stale-maintenance', 'account_ponta', 'member_ponta', 'ocr_running',
          'draft-stale-maintenance', $staleCreatedAt, $staleCreatedAt
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO ocr_jobs (
          id, draft_id, image_id, image_path, requested_screen_type, status, attempt_count,
          created_at, updated_at
        ) VALUES (
          'job-stale-maintenance', 'draft-stale-maintenance', 'image-stale-maintenance',
          '/tmp/stale.png', 'total_assets', 'queued', 0, $staleCreatedAt, $staleCreatedAt
        )
      """.update.run.transact(transactor)
      failed <- repo.failStaleJobs(now, now.minusSeconds(300))
      job <- sql"""
        SELECT status, failure_code, failure_retryable, finished_at
        FROM ocr_jobs
        WHERE id = 'job-stale-maintenance'
      """.query[(String, String, Boolean, Instant)].unique.transact(transactor)
      draftStatus <- sql"""
        SELECT status FROM match_drafts WHERE id = 'match-draft-stale-maintenance'
      """.query[String].unique.transact(transactor)
    yield
      assertEquals(failed, 1)
      assertEquals(job, ("failed", "OCR_TIMEOUT", true, now))
      assertEquals(draftStatus, "ocr_failed")
