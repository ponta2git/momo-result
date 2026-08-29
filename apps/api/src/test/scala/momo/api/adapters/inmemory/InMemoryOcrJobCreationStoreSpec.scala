package momo.api.adapters.inmemory
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{
  MatchDraft,
  MatchDraftStatus,
  OcrDraft,
  OcrJob,
  OcrJobHints,
  ScreenType,
  StoredImageLocation
}
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{
  OcrJobCreationPlan,
  OcrJobCreationStore,
  OcrJobDraftAttachment,
  OcrQueueDispatchIntent
}
import momo.api.testing.AppErrorAssertions.assertAppException

final class InMemoryOcrJobCreationStoreSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-15T00:00:00Z")
  private val matchDraftId = MatchDraftId.unsafeFromString("match-draft-ocr-create")
  private val imageId = ImageId.unsafeFromString("image-ocr-create")
  private val imageLocation =
    StoredImageLocation.unsafeFromString("/tmp/momo-result/uploads/image-ocr-create.png")

  test("store rejects duplicate OCR drafts before attaching match draft artifacts"):
    for
      fixture <- newFixture
      draft = ocrDraft("ocr-draft-duplicate", "ocr-job-new")
      job = queuedJob("ocr-job-new", draft.id)
      _ <- fixture.matchDrafts.create(editableMatchDraft)
      _ <- fixture.drafts.create(draft)
      result <- fixture.store.store(plan(job, draft, Some(attachment(draft.id)), 10)).attempt
      matchDraft <- fixture.matchDrafts.find(matchDraftId)
    yield
      assertAppException(result, "CONFLICT", "ocr draft already exists")
      assertEquals(matchDraft.flatMap(_.totalAssetsDraftId), None)
      assertEquals(matchDraft.flatMap(_.totalAssetsImageId), None)

  test("store returns active limit rejection without inserting OCR records"):
    for
      fixture <- newFixture
      draft = ocrDraft("ocr-draft-active-limit", "ocr-job-active-limit")
      job = queuedJob("ocr-job-active-limit", draft.id)
      result <- fixture.store.store(plan(job, draft, None, 0))
      storedDraft <- fixture.drafts.find(draft.id)
      storedJob <- fixture.jobs.find(job.id)
    yield
      assertActiveLimit(result, 0)
      assertEquals(storedDraft, None)
      assertEquals(storedJob, None)

  test("store returns match draft attachment rejection without inserting OCR records"):
    for
      fixture <- newFixture
      draft = ocrDraft("ocr-draft-attach-failed", "ocr-job-attach-failed")
      job = queuedJob("ocr-job-attach-failed", draft.id)
      result <- fixture.store.store(plan(job, draft, Some(attachment(draft.id)), 10))
      storedDraft <- fixture.drafts.find(draft.id)
      storedJob <- fixture.jobs.find(job.id)
    yield
      assertAttachFailed(result, matchDraftId)
      assertEquals(storedDraft, None)
      assertEquals(storedJob, None)

  test("store rejects inconsistent duplicated image identity before mutation"):
    for
      fixture <- newFixture
      draft = ocrDraft("ocr-draft-invalid-plan", "ocr-job-invalid-plan")
      job = queuedJob("ocr-job-invalid-plan", draft.id)
      inconsistent = attachment(draft.id).copy(
        sourceImageId = ImageId.unsafeFromString("different-source-image")
      )
      result <- fixture.store.store(plan(job, draft, Some(inconsistent), 10))
      storedDraft <- fixture.drafts.find(draft.id)
      storedJob <- fixture.jobs.find(job.id)
    yield
      assertEquals(result, Left(OcrJobCreationRejection.InvalidPlan))
      assertEquals(storedDraft, None)
      assertEquals(storedJob, None)

  private def newFixture: IO[Fixture] =
    for
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      jobs <- InMemoryOcrJobsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      store =
        InMemoryOcrJobCreationStore[IO](
          drafts,
          drafts.create,
          jobs,
          jobs.create,
          matchDrafts,
          jobs.existsActiveByDraft,
        )
    yield Fixture(drafts, jobs, matchDrafts, store)

  private def editableMatchDraft: MatchDraft = MatchDraft.fromInputs(
    id = matchDraftId,
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    status = MatchDraftStatus.DraftReady,
    heldEventId = None,
    matchNoInEvent = None,
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = None,
    totalAssetsImageId = None,
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    confirmedMatchId = None,
    createdAt = now,
    updatedAt = now,
  ).getOrElse(fail("test fixture draft should be valid"))

  private def ocrDraft(id: String, jobId: String): OcrDraft = OcrDraft(
    id = OcrDraftId.unsafeFromString(id),
    jobId = OcrJobId.unsafeFromString(jobId),
    requestedScreenType = ScreenType.TotalAssets,
    detectedScreenType = None,
    profileId = None,
    payloadJson = "{}",
    warningsJson = "[]",
    timingsMsJson = "{}",
    createdAt = now,
    updatedAt = now,
  )

  private def queuedJob(id: String, draftId: OcrDraftId): OcrJob = OcrJob.Queued(
    id = OcrJobId.unsafeFromString(id),
    draftId = draftId,
    imageId = imageId,
    imageLocation = imageLocation,
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = now,
    updatedAt = now,
  )

  private def attachment(ocrDraftId: OcrDraftId): OcrJobDraftAttachment = OcrJobDraftAttachment(
    draftId = matchDraftId,
    screenType = ScreenType.TotalAssets,
    sourceImageId = imageId,
    ocrDraftId = ocrDraftId,
    updatedAt = now,
  )

  private def enqueueRequest(job: OcrJob, draft: OcrDraft): OcrJobEnqueueRequest =
    OcrJobEnqueueRequest(
      jobId = job.id,
      draftId = draft.id,
      imageId = job.imageId,
      imageLocation = job.imageLocation,
      imageSha256 = "ab" * 32,
      imageByteLength = 1L,
      imageMediaType = "image/png",
      requestedScreenType = job.requestedScreenType,
      attempt = 1,
      enqueuedAt = now,
      hints = OcrJobHints.empty,
      requestId = None,
    )

  private def plan(
      job: OcrJob,
      draft: OcrDraft,
      attachment: Option[OcrJobDraftAttachment],
      activeJobLimit: Int,
  ): OcrJobCreationPlan =
    val dispatch = OcrQueueDispatchIntent(
      enqueueRequest = enqueueRequest(job, draft),
      matchDraftId = attachment.map(_.draftId),
    )
    OcrJobCreationPlan(
      draft = draft,
      job = job,
      matchDraftAttachment = attachment,
      queueDispatch = dispatch,
      activeJobLimit = activeJobLimit,
    )

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

  private final case class Fixture(
      drafts: InMemoryOcrDraftsRepository[IO],
      jobs: InMemoryOcrJobsRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      store: InMemoryOcrJobCreationStore[IO],
  )
