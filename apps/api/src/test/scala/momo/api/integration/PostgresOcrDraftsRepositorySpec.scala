package momo.api.integration

import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresOcrDraftsRepository
import momo.api.domain.ids.OcrDraftId

final class PostgresOcrDraftsRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-08-14T10:00:00Z")
  private def repo = PostgresOcrDraftsRepository[IO](transactor)

  test("findMany loads all requested drafts in one bounded query and omits missing ids"):
    for
      _ <- insertDraft("draft-bulk-a", "job-bulk-a")
      _ <- insertDraft("draft-bulk-b", "job-bulk-b")
      result <- repo.findMany(List(
        OcrDraftId.unsafeFromString("draft-bulk-b"),
        OcrDraftId.unsafeFromString("missing"),
        OcrDraftId.unsafeFromString("draft-bulk-a"),
        OcrDraftId.unsafeFromString("draft-bulk-b"),
      ))
    yield assertEquals(
      result.view.mapValues(_.jobId.value).toMap,
      Map(
        OcrDraftId.unsafeFromString("draft-bulk-a") -> "job-bulk-a",
        OcrDraftId.unsafeFromString("draft-bulk-b") -> "job-bulk-b",
      ),
    )

  test("findMany does not query PostgreSQL for an empty request"):
    repo.findMany(Nil).map(result => assertEquals(result, Map.empty))

  private def insertDraft(id: String, jobId: String): IO[Int] = sql"""
    INSERT INTO ocr_drafts (
      id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
      created_at, updated_at
    ) VALUES (
      $id, $jobId, 'total_assets', '{}', '[]', '{}', $now, $now
    )
  """.update.run.transact(transactor)
end PostgresOcrDraftsRepositorySpec
