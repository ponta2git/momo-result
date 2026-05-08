package momo.api.integration

import java.nio.file.Path
import java.time.Instant

import cats.effect.IO
import doobie.implicits.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.postgres.PostgresOcrJobCreationRepository
import momo.api.repositories.{OcrJobDraftAttachment, OcrQueuePayload}

final class PostgresOcrJobCreationRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-08T10:00:00Z")
  private val jobId = OcrJobId("job-outbox-1")
  private val draftId = OcrDraftId("draft-outbox-1")
  private val imageId = ImageId("img-outbox-1")

  private def repo = PostgresOcrJobCreationRepository[IO](transactor)

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
    imagePath = Path.of("/tmp/image.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = now,
    updatedAt = now,
  )

  private def payload: OcrQueuePayload = OcrQueuePayload(Map(
    "jobId" -> jobId.value,
    "draftId" -> draftId.value,
    "imageId" -> imageId.value,
    "imagePath" -> "/tmp/image.png",
    "requestedImageType" -> "total_assets",
    "attempt" -> "1",
    "enqueuedAt" -> "2026-05-08T10:00:00Z",
    "requestId" -> "req-outbox-1",
  ))

  test("createQueuedJob inserts OCR records and durable outbox intent in one transaction"):
    for
      _ <- repo.createQueuedJob(draft, job, None, payload)
      row <- sql"""
        SELECT status, attempt_count, stream_payload->>'jobId', stream_payload->>'requestId'
        FROM ocr_queue_outbox
        WHERE job_id = ${jobId.value}
      """.query[(String, Int, String, String)].unique.transact(transactor)
    yield assertEquals(row, ("PENDING", 0, jobId.value, "req-outbox-1"))

  test("createQueuedJob rolls back OCR records when match draft attachment fails"):
    val attachment = OcrJobDraftAttachment(
      draftId = MatchDraftId("missing-match-draft"),
      screenType = ScreenType.TotalAssets,
      sourceImageId = imageId,
      ocrDraftId = draftId,
      updatedAt = now,
    )
    for
      result <- repo.createQueuedJob(draft, job, Some(attachment), payload).attempt
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assert(result.isLeft, s"expected failed attachment to rollback, got $result")
      assertEquals(counts, (0L, 0L, 0L))
