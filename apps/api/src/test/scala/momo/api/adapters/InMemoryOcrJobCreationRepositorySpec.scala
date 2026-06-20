package momo.api.adapters

import java.nio.file.Path
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{
  MatchDraft, MatchDraftStatus, OcrDraft, OcrJob, OcrJobHints, ScreenType,
}
import momo.api.repositories.{OcrJobDraftAttachment, OcrQueuePayload}
import momo.api.testing.AppErrorAssertions.assertAppException

final class InMemoryOcrJobCreationRepositorySpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-15T00:00:00Z")
  private val matchDraftId = MatchDraftId.unsafeFromString("match-draft-ocr-create")
  private val imageId = ImageId.unsafeFromString("image-ocr-create")
  private val imagePath = Path.of("/tmp/momo-result/uploads/image-ocr-create.png")

  test("createQueuedJob rejects duplicate OCR drafts before attaching match draft artifacts"):
    for
      fixture <- newFixture
      draft = ocrDraft("ocr-draft-duplicate", "ocr-job-new")
      job = queuedJob("ocr-job-new", draft.id)
      _ <- fixture.matchDrafts.create(editableMatchDraft)
      _ <- fixture.drafts.create(draft)
      result <- fixture.repository.createQueuedJob(
        draft,
        job,
        Some(attachment(draft.id)),
        payload(job, draft),
        activeJobLimit = 10,
      ).attempt
      matchDraft <- fixture.matchDrafts.find(matchDraftId)
    yield
      assertAppException(result, "CONFLICT", "ocr draft already exists")
      assertEquals(matchDraft.flatMap(_.totalAssetsDraftId), None)
      assertEquals(matchDraft.flatMap(_.totalAssetsImageId), None)

  test("createQueuedJob rejects duplicate OCR jobs before attaching match draft artifacts"):
    for
      fixture <- newFixture
      draft = ocrDraft("ocr-draft-new", "ocr-job-duplicate")
      job = queuedJob("ocr-job-duplicate", draft.id)
      existing = queuedJob("ocr-job-duplicate", OcrDraftId.unsafeFromString("ocr-draft-existing"))
      _ <- fixture.matchDrafts.create(editableMatchDraft)
      _ <- fixture.jobs.create(existing)
      result <- fixture.repository.createQueuedJob(
        draft,
        job,
        Some(attachment(draft.id)),
        payload(job, draft),
        activeJobLimit = 10,
      ).attempt
      matchDraft <- fixture.matchDrafts.find(matchDraftId)
    yield
      assertAppException(result, "CONFLICT", "ocr job already exists")
      assertEquals(matchDraft.flatMap(_.totalAssetsDraftId), None)
      assertEquals(matchDraft.flatMap(_.totalAssetsImageId), None)

  private def newFixture: IO[Fixture] =
    for
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      jobs <- InMemoryOcrJobsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      repository = InMemoryOcrJobCreationRepository[IO](
        drafts,
        jobs,
        matchDrafts,
        jobs.existsActiveByDraft,
      )
    yield Fixture(drafts, jobs, matchDrafts, repository)

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
    imagePath = imagePath,
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

  private def payload(job: OcrJob, draft: OcrDraft): OcrQueuePayload = OcrQueuePayload.build(
    jobId = job.id,
    draftId = draft.id,
    imageId = job.imageId,
    imagePath = job.imagePath,
    requestedScreenType = job.requestedScreenType,
    attempt = 1,
    enqueuedAt = now,
    hints = OcrJobHints.empty,
    requestId = None,
  )

  private final case class Fixture(
      drafts: InMemoryOcrDraftsRepository[IO],
      jobs: InMemoryOcrJobsRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      repository: InMemoryOcrJobCreationRepository[IO],
  )
