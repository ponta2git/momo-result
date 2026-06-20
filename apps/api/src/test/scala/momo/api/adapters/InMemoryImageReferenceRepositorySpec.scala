package momo.api.adapters

import java.nio.file.Paths
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{
  FailureCode,
  MatchDraft,
  MatchDraftStatus,
  MatchNoInEvent,
  OcrFailure,
  OcrJob,
  ScreenType
}

final class InMemoryImageReferenceRepositorySpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-16T00:00:00Z")
  private val accountId = AccountId.unsafeFromString("account-image-refs")
  private val memberId = MemberId.unsafeFromString("member-image-refs")
  private val heldEventId = HeldEventId.unsafeFromString("held-image-refs")
  private val titleId = GameTitleId.unsafeFromString("title-image-refs")
  private val seasonId = SeasonMasterId.unsafeFromString("season-image-refs")
  private val mapId = MapMasterId.unsafeFromString("map-image-refs")

  test("reports active OCR job images and retained non-terminal draft source images"):
    val activeJobImage = ImageId.unsafeFromString("image-active-job")
    val terminalJobImage = ImageId.unsafeFromString("image-terminal-job")
    val retainedDraftImage = ImageId.unsafeFromString("image-retained-draft")
    val deletedDraftImage = ImageId.unsafeFromString("image-deleted-draft")
    val confirmedDraftImage = ImageId.unsafeFromString("image-confirmed-draft")

    for
      jobs <- InMemoryOcrJobsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      references = InMemoryImageReferenceRepository[IO](jobs, matchDrafts)
      _ <- jobs.create(queuedJob("job-active", "ocr-draft-active", activeJobImage))
      _ <- jobs.create(failedJob("job-terminal", "ocr-draft-terminal", terminalJobImage))
      _ <- matchDrafts.create(draft(
        id = "match-draft-retained",
        status = MatchDraftStatus.DraftReady,
        imageId = retainedDraftImage,
        deletedAt = None,
        confirmedMatchId = None,
      ))
      _ <- matchDrafts.create(draft(
        id = "match-draft-deleted",
        status = MatchDraftStatus.DraftReady,
        imageId = deletedDraftImage,
        deletedAt = Some(now),
        confirmedMatchId = None,
      ))
      _ <- matchDrafts.create(draft(
        id = "match-draft-confirmed",
        status = MatchDraftStatus.Confirmed,
        imageId = confirmedDraftImage,
        deletedAt = None,
        confirmedMatchId = Some(MatchId.unsafeFromString("match-confirmed-image-ref")),
      ))
      referenced <- references.referencedImageIds
    yield assertEquals(referenced, Set(activeJobImage, retainedDraftImage))

  private def queuedJob(id: String, draftId: String, imageId: ImageId): OcrJob = OcrJob.Queued(
    id = OcrJobId.unsafeFromString(id),
    draftId = OcrDraftId.unsafeFromString(draftId),
    imageId = imageId,
    imagePath = Paths.get(s"/tmp/${imageId.value}.png"),
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = now,
    updatedAt = now,
  )

  private def failedJob(id: String, draftId: String, imageId: ImageId): OcrJob = OcrJob.Failed(
    id = OcrJobId.unsafeFromString(id),
    draftId = OcrDraftId.unsafeFromString(draftId),
    imageId = imageId,
    imagePath = Paths.get(s"/tmp/${imageId.value}.png"),
    requestedScreenType = ScreenType.TotalAssets,
    failedDetectedScreenType = None,
    attemptCount = 1,
    failedWorkerId = None,
    failedFailure = OcrFailure(FailureCode.QueueFailure, "failed", retryable = false, None),
    failedStartedAt = None,
    failedFinishedAt = now,
    failedDurationMs = None,
    createdAt = now,
    updatedAt = now,
  )

  private def draft(
      id: String,
      status: MatchDraftStatus,
      imageId: ImageId,
      deletedAt: Option[Instant],
      confirmedMatchId: Option[MatchId],
  ): MatchDraft = MatchDraft.fromInputs(
    id = MatchDraftId.unsafeFromString(id),
    createdByAccountId = accountId,
    createdByMemberId = Some(memberId),
    status = status,
    heldEventId = Some(heldEventId),
    matchNoInEvent = Some(MatchNoInEvent.unsafeFromInt(1)),
    gameTitleId = Some(titleId),
    layoutFamily = Some("world"),
    seasonMasterId = Some(seasonId),
    ownerMemberId = Some(memberId),
    mapMasterId = Some(mapId),
    playedAt = Some(now),
    totalAssetsImageId = Some(imageId),
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = deletedAt,
    confirmedMatchId = confirmedMatchId,
    createdAt = now,
    updatedAt = now,
  ).fold(error => fail(error.message), identity)
