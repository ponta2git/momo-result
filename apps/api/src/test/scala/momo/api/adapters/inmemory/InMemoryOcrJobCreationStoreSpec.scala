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
  OcrSubmission,
  OcrSubmissionMember,
  ScreenType,
  StoredImageLocation
}
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.contract.OcrJobCreationStoreContract
import momo.api.repositories.contract.OcrJobCreationStoreContract.{CreationFixture, CreationState}
import momo.api.repositories.{
  OcrJobCreationPlan,
  OcrJobDraftAttachment,
  OcrJobSubmissionBinding,
  OcrQueueDispatchIntent
}
import momo.api.testing.AppErrorAssertions.assertAppException

final class InMemoryOcrJobCreationStoreSpec
    extends MomoCatsEffectSuite with OcrJobCreationStoreContract:
  private def now = Instant.parse("2026-05-15T00:00:00Z")
  private def matchDraftId = MatchDraftId.unsafeFromString("match-draft-ocr-create")
  private def imageId = ImageId.unsafeFromString("image-ocr-create")
  private def imageLocation =
    StoredImageLocation.unsafeFromString("/tmp/momo-result/uploads/image-ocr-create.png")

  test("store rejects duplicate OCR drafts before attaching match draft artifacts"):
    for
      fixture <- newFixture
      draft = ocrDraft("ocr-draft-duplicate", "ocr-job-new")
      job = queuedJob("ocr-job-new", draft.id)
      _ <- fixture.drafts.create(draft)
      result <- fixture.store.store(plan(job, draft, attachment(draft.id), 10)).attempt
      matchDraft <- fixture.matchDrafts.find(matchDraftId)
    yield
      assertAppException(result, "CONFLICT", "ocr draft already exists")
      assertEquals(matchDraft.flatMap(_.totalAssetsDraftId), None)
      assertEquals(matchDraft.flatMap(_.totalAssetsImageId), None)

  test("store refuses a submission whose source draft was deleted without inserting OCR records"):
    for
      fixture <- newFixture
      _ <- fixture.matchDrafts.takeForCancellation(
        matchDraftId,
        AccountId.unsafeFromString("account_ponta")
      )
      draft = ocrDraft("ocr-draft-attach-failed", "ocr-job-attach-failed")
      job = queuedJob("ocr-job-attach-failed", draft.id)
      result <- fixture.store.store(plan(job, draft, attachment(draft.id), 10))
      storedDraft <- fixture.drafts.find(draft.id)
      storedJob <- fixture.jobs.find(job.id)
    yield
      assertEquals(result, Left(OcrJobCreationRejection.SubmissionRejected))
      assertEquals(storedDraft, None)
      assertEquals(storedJob, None)

  override protected def freshCreationFixture(admissionDeadline: Instant): IO[CreationFixture] =
    for
      fixture <- newFixture(admissionDeadline)
      draft = ocrDraft("ocr-draft-contract", "ocr-job-contract")
      job = queuedJob("ocr-job-contract", draft.id)
    yield CreationFixture(
      fixture.store,
      plan(job, draft, attachment(draft.id), 10),
      for
        savedJob <- fixture.jobs.find(job.id)
        savedDraft <- fixture.drafts.find(draft.id)
        sourceDraft <- fixture.matchDrafts.find(matchDraftId)
        submission <- fixture.submissions.find(
          "00000000-0000-4000-8000-000000000001",
          AccountId.unsafeFromString("account_ponta"),
        )
      yield CreationState(savedJob, savedDraft, sourceDraft, submission),
    )

  private def newFixture: IO[Fixture] = IO.realTimeInstant
    .flatMap(time => newFixture(time.plusSeconds(3600)))

  private def newFixture(admissionDeadline: Instant): IO[Fixture] =
    for
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      jobs <- InMemoryOcrJobsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      _ <- matchDrafts.create(editableMatchDraft)
      submissions <- InMemoryOcrSubmissionsRepository.create[IO](matchDrafts)
      _ <- submissions.put(OcrSubmission(
        "00000000-0000-4000-8000-000000000001",
        AccountId.unsafeFromString("account_ponta"),
        matchDraftId,
        OcrJobHints.empty,
        "open",
        admissionDeadline,
        now,
        None,
        List(OcrSubmissionMember(ScreenType.TotalAssets, "a" * 64, "ab" * 32, 1))
      ))
      store =
        InMemoryOcrJobCreationStore[IO](
          drafts,
          drafts.create,
          jobs,
          jobs.create,
          matchDrafts,
          jobs.existsActiveByDraft,
          submissions,
          IO.realTimeInstant,
        )
    yield Fixture(drafts, jobs, matchDrafts, submissions, store)

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
      attachment: OcrJobDraftAttachment,
      activeJobLimit: Int,
  ): OcrJobCreationPlan =
    val dispatch = OcrQueueDispatchIntent(
      enqueueRequest = enqueueRequest(job, draft),
      matchDraftId = attachment.draftId,
    )
    OcrJobCreationPlan(
      submission = OcrJobSubmissionBinding(
        "00000000-0000-4000-8000-000000000001",
        AccountId.unsafeFromString("account_ponta")
      ),
      draft = draft,
      job = job,
      matchDraftAttachment = attachment,
      queueDispatch = dispatch,
      activeJobLimit = activeJobLimit,
    )

  private final case class Fixture(
      drafts: InMemoryOcrDraftsRepository[IO],
      jobs: InMemoryOcrJobsRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      submissions: InMemoryOcrSubmissionsRepository[IO],
      store: InMemoryOcrJobCreationStore[IO],
  )
