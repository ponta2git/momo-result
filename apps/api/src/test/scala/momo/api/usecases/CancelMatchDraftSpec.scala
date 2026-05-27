package momo.api.usecases

import java.nio.file.Path
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryMatchDraftsRepository, InMemoryOcrJobsRepository, LocalFsImageStore,
}
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError

final class CancelMatchDraftSpec extends MomoCatsEffectSuite:
  private val createdAt = Instant.parse("2026-05-20T10:00:00Z")
  private val cancelledAt = Instant.parse("2026-05-20T10:05:00Z")
  private val ownerAccountId = AccountId.unsafeFromString("account_ponta")
  private val otherAccountId = AccountId.unsafeFromString("account_otaka")
  private val draftId = MatchDraftId.unsafeFromString("draft-cancel-usecase")
  private val ocrDraftId = OcrDraftId.unsafeFromString("ocr-draft-cancel-usecase")
  private val jobId = OcrJobId.unsafeFromString("ocr-job-cancel-usecase")

  test("discarding a draft physically deletes it and cancels queued OCR jobs"):
    tempDirectory("momo-api-cancel-match-draft").use { dir =>
      for
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        ocrJobs <- InMemoryOcrJobsRepository.createWithDraftCancelSync[IO](matchDrafts)
        _ <- matchDrafts.create(sampleDraft(MatchDraftStatus.OcrRunning))
        _ <- ocrJobs.create(sampleQueuedJob)
        usecase = CancelMatchDraft[IO](
          matchDrafts,
          ocrJobs,
          PurgeSourceImages[IO](matchDrafts, LocalFsImageStore[IO](dir)),
          IO.pure(cancelledAt),
        )
        result <- usecase.run(draftId, ownerAccountId)
        foundDraft <- matchDrafts.find(draftId)
        foundJob <- ocrJobs.find(jobId)
      yield
        assertEquals(result, Right(()))
        assertEquals(foundDraft, None)
        assertEquals(foundJob.map(_.status), Some(OcrJobStatus.Cancelled))
    }

  test("rejects deletion by accounts that did not create the draft"):
    tempDirectory("momo-api-cancel-match-draft-forbidden").use { dir =>
      for
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        ocrJobs <- InMemoryOcrJobsRepository.create[IO]
        _ <- matchDrafts.create(sampleDraft(MatchDraftStatus.NeedsReview))
        usecase = CancelMatchDraft[IO](
          matchDrafts,
          ocrJobs,
          PurgeSourceImages[IO](matchDrafts, LocalFsImageStore[IO](dir)),
          IO.pure(cancelledAt),
        )
        result <- usecase.run(draftId, otherAccountId)
        foundDraft <- matchDrafts.find(draftId)
      yield
        assertEquals(result, Left(AppError.Forbidden("You cannot cancel this match draft.")))
        assert(foundDraft.nonEmpty)
    }

  private def sampleDraft(status: MatchDraftStatus): MatchDraft = MatchDraft.fromInputs(
    id = draftId,
    createdByAccountId = ownerAccountId,
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    status = status,
    heldEventId = None,
    matchNoInEvent = None,
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = None,
    totalAssetsImageId = Some(ImageId.unsafeFromString("image-cancel-usecase")),
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = Some(ocrDraftId),
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    confirmedMatchId = None,
    createdAt = createdAt,
    updatedAt = createdAt,
  ).getOrElse(fail("invalid draft fixture"))

  private def sampleQueuedJob: OcrJob = OcrJob.Queued(
    id = jobId,
    draftId = ocrDraftId,
    imageId = ImageId.unsafeFromString("image-cancel-usecase"),
    imagePath = Path.of("/tmp/image-cancel-usecase.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = createdAt,
    updatedAt = createdAt,
  )
end CancelMatchDraftSpec
