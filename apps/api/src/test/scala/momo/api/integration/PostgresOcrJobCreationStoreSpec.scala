package momo.api.integration
import java.time.Instant

import cats.effect.IO
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import io.circe.Json

import momo.api.adapters.postgres.PostgresOcrJobCreationStore
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{
  OcrJobCreationPlan,
  OcrJobCreationStore,
  OcrJobDraftAttachment,
  OcrQueueDispatchIntent
}
import momo.api.testing.JsonSchemaAssertions

final class PostgresOcrJobCreationStoreSpec extends IntegrationSuite with JsonSchemaAssertions:

  private val now = Instant.parse("2026-05-08T10:00:00Z")
  private val jobId = OcrJobId.unsafeFromString("job-outbox-1")
  private val draftId = OcrDraftId.unsafeFromString("draft-outbox-1")
  private val imageId = ImageId.unsafeFromString("img-outbox-1")

  private def repo = PostgresOcrJobCreationStore[IO](transactor)

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
    imageLocation = StoredImageLocation.unsafeFromString("/tmp/image.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = now,
    updatedAt = now,
  )

  private def enqueueRequest: OcrJobEnqueueRequest = OcrJobEnqueueRequest(
    jobId = jobId,
    draftId = draftId,
    imageId = imageId,
    imageLocation = StoredImageLocation.unsafeFromString("/tmp/image.png"),
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
      result <- repo.store(plan(job, draft, None, activeJobLimit = 12))
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
      assertOcrWorkerJobMessageSchemaValid(row._5)

  test("store rejects over the active job limit before inserting related rows"):
    for
      result <- repo.store(plan(job, draft, None, activeJobLimit = 0))
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
      result <- repo.store(plan(job, draft, Some(attachment), activeJobLimit = 12))
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
      result <- repo.store(plan(job, invalidDraft, None, activeJobLimit = 12)).attempt
      counts <- sql"""
        SELECT
          (SELECT count(*) FROM ocr_drafts WHERE id = ${draftId.value}),
          (SELECT count(*) FROM ocr_jobs WHERE id = ${jobId.value}),
          (SELECT count(*) FROM ocr_queue_outbox WHERE job_id = ${jobId.value})
      """.query[(Long, Long, Long)].unique.transact(transactor)
    yield
      assert(result.left.exists(_.getMessage.contains("payloadJson")))
      assertEquals(counts, (0L, 0L, 0L))

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
