package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{InMemoryMatchDraftsRepository, LocalFsImageStore}
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, StoredImage}
import momo.api.errors.AppError
import momo.api.repositories.ImageStore

final class PurgeSourceImagesSpec extends MomoCatsEffectSuite:
  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

  test("keeps source images before cleanup and deletes them at cleanup time") {
    val createdAt = Instant.parse("2026-05-04T01:00:00Z")
    val finalizedAt = Instant.parse("2026-05-04T01:30:00Z")
    tempDirectory("momo-api-source-image-retention").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        totalAssets <- saveImage(imageStore, "total.png")
        revenue <- saveImage(imageStore, "revenue.png")
        incidentLog <- saveImage(imageStore, "incident.png")
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        draft = MatchDraft.fromInputs(
          id = MatchDraftId.unsafeFromString("draft-1"),
          createdByAccountId = AccountId.unsafeFromString("account-1"),
          createdByMemberId = Some(MemberId.unsafeFromString("member-1")),
          status = MatchDraftStatus.NeedsReview,
          heldEventId = None,
          matchNoInEvent = None,
          gameTitleId = None,
          layoutFamily = None,
          seasonMasterId = None,
          ownerMemberId = None,
          mapMasterId = None,
          playedAt = None,
          totalAssetsImageId = Some(totalAssets.imageId),
          revenueImageId = Some(revenue.imageId),
          incidentLogImageId = Some(incidentLog.imageId),
          totalAssetsDraftId = None,
          revenueDraftId = None,
          incidentLogDraftId = None,
          sourceImagesRetainedUntil = None,
          sourceImagesDeletedAt = None,
          confirmedMatchId = None,
          createdAt = createdAt,
          updatedAt = createdAt,
        ).getOrElse(fail("invalid draft fixture"))
        _ <- matchDrafts.create(draft)
        beforeCleanup <- imageStore.find(totalAssets.imageId)
        service = PurgeSourceImages[IO](matchDrafts, imageStore)
        _ <- service.run(draft.id, finalizedAt)
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
  }

  test("marks retention before deleting files so delete failures do not leave live DB references") {
    val createdAt = Instant.parse("2026-05-04T02:00:00Z")
    val finalizedAt = Instant.parse("2026-05-04T02:30:00Z")
    val deleteError = RuntimeException("delete failed")
    tempDirectory("momo-api-source-image-retention-delete-failure").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        totalAssets <- saveImage(imageStore, "total.png")
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        draft = MatchDraft.fromInputs(
          id = MatchDraftId.unsafeFromString("draft-delete-failure"),
          createdByAccountId = AccountId.unsafeFromString("account-1"),
          createdByMemberId = Some(MemberId.unsafeFromString("member-1")),
          status = MatchDraftStatus.NeedsReview,
          heldEventId = None,
          matchNoInEvent = None,
          gameTitleId = None,
          layoutFamily = None,
          seasonMasterId = None,
          ownerMemberId = None,
          mapMasterId = None,
          playedAt = None,
          totalAssetsImageId = Some(totalAssets.imageId),
          revenueImageId = None,
          incidentLogImageId = None,
          totalAssetsDraftId = None,
          revenueDraftId = None,
          incidentLogDraftId = None,
          sourceImagesRetainedUntil = None,
          sourceImagesDeletedAt = None,
          confirmedMatchId = None,
          createdAt = createdAt,
          updatedAt = createdAt,
        ).getOrElse(fail("invalid draft fixture"))
        _ <- matchDrafts.create(draft)
        failingStore = failingDeleteStore(imageStore, deleteError)
        service = PurgeSourceImages[IO](matchDrafts, failingStore)
        result <- service.run(draft.id, finalizedAt).attempt
        updatedDraft <- matchDrafts.find(draft.id)
        imageAfter <- imageStore.find(totalAssets.imageId)
        sourceImages = GetMatchDraftSourceImages[IO](matchDrafts, imageStore)
        listed <- sourceImages.list(draft.id, AccountId.unsafeFromString("account-1"))
        streamed <- sourceImages.stream(
          draft.id,
          MatchDraftSourceImageKind.TotalAssets.wire,
          AccountId.unsafeFromString("account-1"),
        )
      yield
        assertEquals(result.swap.toOption, Some(deleteError))
        assertEquals(updatedDraft.flatMap(_.sourceImagesRetainedUntil), Some(finalizedAt))
        assertEquals(updatedDraft.flatMap(_.sourceImagesDeletedAt), Some(finalizedAt))
        assert(imageAfter.nonEmpty)
        assertEquals(listed, Right(Nil))
        streamed match
          case Left(AppError.NotFound(_, _)) => ()
          case other => fail(s"expected source image to be hidden after retention mark, got $other")
    }
  }

  private def saveImage(
      imageStore: LocalFsImageStore[IO],
      fileName: String,
  ): IO[momo.api.domain.StoredImage] = imageStore.save(Some(fileName), Some("image/png"), pngBytes)
    .flatMap {
      case Right(image) => IO.pure(image)
      case Left(error) => fail(s"expected image to be stored: $error")
    }

  private def failingDeleteStore(
      delegate: LocalFsImageStore[IO],
      error: Throwable,
  ): ImageStore[IO] = new ImageStore[IO]:
    override def save(
        fileName: Option[String],
        contentType: Option[String],
        bytes: Array[Byte],
    ): IO[Either[AppError, StoredImage]] = delegate.save(fileName, contentType, bytes)
    override def find(imageId: ImageId): IO[Option[StoredImage]] = delegate.find(imageId)
    override def readBytes(image: StoredImage): IO[Array[Byte]] = delegate.readBytes(image)
    override def delete(imageId: ImageId): IO[Boolean] =
      val _ = imageId
      IO.raiseError(error)
