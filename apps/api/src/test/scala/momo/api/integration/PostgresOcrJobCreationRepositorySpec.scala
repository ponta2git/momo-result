package momo.api.integration

import java.nio.file.Path
import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import io.circe.Json

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.postgres.PostgresOcrJobCreationRepository
import momo.api.repositories.{OcrJobCreationRepository, OcrJobDraftAttachment, OcrQueuePayload}
import momo.api.testing.JsonSchemaAssertions

final class PostgresOcrJobCreationRepositorySpec extends IntegrationSuite with JsonSchemaAssertions:

  private val now = Instant.parse("2026-05-08T10:00:00Z")
  private val jobId = OcrJobId.unsafeFromString("job-outbox-1")
  private val draftId = OcrDraftId.unsafeFromString("draft-outbox-1")
  private val imageId = ImageId.unsafeFromString("img-outbox-1")

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

  private def payload: OcrQueuePayload = OcrQueuePayload.build(
    jobId = jobId,
    draftId = draftId,
    imageId = imageId,
    imagePath = Path.of("/tmp/image.png"),
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

  test("createQueuedJob inserts OCR records and durable outbox intent in one transaction"):
    for
      _ <- repo.createQueuedJob(draft, job, None, payload, activeJobLimit = 12)
      row <- sql"""
        SELECT status, attempt_count, stream_payload->>'jobId', stream_payload->>'requestId',
               stream_payload
        FROM ocr_queue_outbox
        WHERE job_id = ${jobId.value}
      """.query[(String, Int, String, String, Json)].unique.transact(transactor)
    yield
      assertEquals(row._1, "PENDING")
      assertEquals(row._2, 0)
      assertEquals(row._3, jobId.value)
      assertEquals(row._4, "req-outbox-1")
      assertOcrQueuePayloadSchemaValid(row._5)

  test("createQueuedJob rejects over the active job limit before inserting related rows"):
    for
      result <- repo.createQueuedJob(draft, job, None, payload, activeJobLimit = 0).attempt
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      result match
        case Left(_: OcrJobCreationRepository.ActiveJobLimitExceeded) => ()
        case other => fail(s"expected active limit rejection, got $other")
      assertEquals(counts, (0L, 0L, 0L))

  test("createQueuedJob rolls back OCR records when match draft attachment fails"):
    val attachment = OcrJobDraftAttachment(
      draftId = MatchDraftId.unsafeFromString("missing-match-draft"),
      screenType = ScreenType.TotalAssets,
      sourceImageId = imageId,
      ocrDraftId = draftId,
      updatedAt = now,
    )
    for
      result <- repo.createQueuedJob(draft, job, Some(attachment), payload, activeJobLimit = 12)
        .attempt
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assert(result.isLeft, s"expected failed attachment to rollback, got $result")
      assertEquals(counts, (0L, 0L, 0L))

  test("createQueuedJob rejects invalid draft JSON before inserting related rows"):
    val invalidDraft = draft.copy(payloadJson = "{")
    for
      result <- repo.createQueuedJob(invalidDraft, job, None, payload, activeJobLimit = 12).attempt
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assert(result.left.exists(_.getMessage.contains("payloadJson")))
      assertEquals(counts, (0L, 0L, 0L))
