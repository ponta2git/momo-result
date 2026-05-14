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

  test("failStaleJobs keeps a multi-slot draft running while another slot is still active"):
    val staleCreatedAt = now.minusSeconds(600)
    val freshCreatedAt = now.minusSeconds(60)
    for
      _ <- sql"""
        INSERT INTO ocr_drafts (
          id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
          created_at, updated_at
        ) VALUES
          (
            'draft-stale-slot-maintenance',
            'job-stale-slot-maintenance',
            'total_assets',
            '{}',
            '[]',
            '{}',
            $staleCreatedAt,
            $staleCreatedAt
          ),
          (
            'draft-fresh-slot-maintenance',
            'job-fresh-slot-maintenance',
            'revenue',
            '{}',
            '[]',
            '{}',
            $freshCreatedAt,
            $freshCreatedAt
          )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status, total_assets_draft_id,
          revenue_draft_id, created_at, updated_at
        ) VALUES (
          'match-draft-multislot-maintenance',
          'account_ponta',
          'member_ponta',
          'ocr_running',
          'draft-stale-slot-maintenance',
          'draft-fresh-slot-maintenance',
          $staleCreatedAt,
          $staleCreatedAt
        )
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO ocr_jobs (
          id, draft_id, image_id, image_path, requested_screen_type, status, attempt_count,
          created_at, updated_at
        ) VALUES
          (
            'job-stale-slot-maintenance',
            'draft-stale-slot-maintenance',
            'image-stale-slot-maintenance',
            '/tmp/stale-slot.png',
            'total_assets',
            'queued',
            0,
            $staleCreatedAt,
            $staleCreatedAt
          ),
          (
            'job-fresh-slot-maintenance',
            'draft-fresh-slot-maintenance',
            'image-fresh-slot-maintenance',
            '/tmp/fresh-slot.png',
            'revenue',
            'queued',
            0,
            $freshCreatedAt,
            $freshCreatedAt
          )
      """.update.run.transact(transactor)
      failed <- repo.failStaleJobs(now, now.minusSeconds(300))
      jobStatuses <- sql"""
        SELECT id, status FROM ocr_jobs
        WHERE id IN ('job-stale-slot-maintenance', 'job-fresh-slot-maintenance')
        ORDER BY id
      """.query[(String, String)].to[List].transact(transactor)
      draftStatus <- sql"""
        SELECT status FROM match_drafts WHERE id = 'match-draft-multislot-maintenance'
      """.query[String].unique.transact(transactor)
    yield
      assertEquals(failed, 1)
      assertEquals(
        jobStatuses,
        List("job-fresh-slot-maintenance" -> "queued", "job-stale-slot-maintenance" -> "failed"),
      )
      assertEquals(draftStatus, "ocr_running")
