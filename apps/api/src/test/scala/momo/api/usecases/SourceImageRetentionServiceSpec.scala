package momo.api.usecases

import java.nio.file.Files
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{InMemoryMatchDraftsRepository, LocalFsImageStore}
import momo.api.domain.ids.MemberId
import momo.api.domain.{MatchDraft, MatchDraftStatus}

final class SourceImageRetentionServiceSpec extends MomoCatsEffectSuite:
  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  test("keeps source images before cleanup and deletes them at cleanup time") {
    val createdAt = Instant.parse("2026-05-04T01:00:00Z")
    val finalizedAt = Instant.parse("2026-05-04T01:30:00Z")
    for
      dir <- IO.blocking(Files.createTempDirectory("momo-api-source-image-retention"))
      imageStore = LocalFsImageStore[IO](dir)
      totalAssets <- saveImage(imageStore, "total.png")
      revenue <- saveImage(imageStore, "revenue.png")
      incidentLog <- saveImage(imageStore, "incident.png")
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      draft = MatchDraft(
        id = "draft-1",
        createdByMemberId = MemberId("member-1").value,
        status = MatchDraftStatus.NeedsReview,
        heldEventId = None,
        matchNoInEvent = None,
        gameTitleId = None,
        layoutFamily = None,
        seasonMasterId = None,
        ownerMemberId = None,
        mapMasterId = None,
        playedAt = None,
        totalAssetsImageId = Some(totalAssets.imageId.value),
        revenueImageId = Some(revenue.imageId.value),
        incidentLogImageId = Some(incidentLog.imageId.value),
        totalAssetsDraftId = None,
        revenueDraftId = None,
        incidentLogDraftId = None,
        sourceImagesRetainedUntil = None,
        sourceImagesDeletedAt = None,
        confirmedMatchId = None,
        createdAt = createdAt,
        updatedAt = createdAt,
      )
      _ <- matchDrafts.create(draft)
      beforeCleanup <- imageStore.find(totalAssets.imageId)
      service = SourceImageRetentionService[IO](matchDrafts, imageStore)
      _ <- service.cleanupNow(draft.id, finalizedAt)
      totalAfter <- imageStore.find(totalAssets.imageId)
      revenueAfter <- imageStore.find(revenue.imageId)
      incidentAfter <- imageStore.find(incidentLog.imageId)
      updatedDraft <- matchDrafts.find(draft.id)
    yield
      assert(beforeCleanup.nonEmpty)
      assertEquals(totalAfter, None)
      assertEquals(revenueAfter, None)
      assertEquals(incidentAfter, None)
      assertEquals(updatedDraft.flatMap(_.sourceImagesRetainedUntil), Some(finalizedAt))
      assertEquals(updatedDraft.flatMap(_.sourceImagesDeletedAt), Some(finalizedAt))
  }

  private def saveImage(
      imageStore: LocalFsImageStore[IO],
      fileName: String,
  ): IO[momo.api.domain.StoredImage] = imageStore.save(Some(fileName), Some("image/png"), pngBytes)
    .flatMap {
      case Right(image) => IO.pure(image)
      case Left(error) => fail(s"expected image to be stored: $error")
    }
