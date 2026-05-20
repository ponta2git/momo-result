package momo.api.usecases

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import java.time.Instant
import java.util.zip.ZipInputStream

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{InMemoryMatchDraftsRepository, LocalFsImageStore}
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent, StoredImage}
import momo.api.errors.AppError
import momo.api.testing.{NoReadImageStore, TestImages}

final class GetMatchDraftSourceImagesSpec extends MomoCatsEffectSuite:
  private val accountId = AccountId.unsafeFromString("account-1")
  private val otherAccountId = AccountId.unsafeFromString("account-2")
  private val createdAt = Instant.parse("2026-05-17T23:59:00Z")
  private val playedAt = Instant.parse("2026-05-17T23:30:00Z")

  test("archives all available source images with stable public names") {
    tempDirectory("momo-api-source-image-archive-all").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        totalAssets <- saveImage(imageStore, TestImages.png1x1, "image/png")
        revenueBytes = TestImages.jpeg(1, 1)
        revenue <- saveImage(imageStore, revenueBytes, "image/jpeg")
        incidentBytes = TestImages.webp(1, 1)
        incidentLog <- saveImage(imageStore, incidentBytes, "image/webp")
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        draft = draftWithImages(
          totalAssets = Some(totalAssets.imageId),
          revenue = Some(revenue.imageId),
          incidentLog = Some(incidentLog.imageId),
          matchNo = Some(3),
          playedAt = Some(playedAt),
          sourceImagesDeletedAt = None,
        )
        _ <- matchDrafts.create(draft)
        service = GetMatchDraftSourceImages[IO](matchDrafts, imageStore)
        archive <- service.archive(draft.id, accountId)
      yield
        val file = archive.getOrElse(fail("expected archive"))
        assertEquals(file.contentType, "application/zip")
        assertEquals(file.fileName, "momo-ocr-images-20260518-match-03.zip")
        assert(!file.fileName.contains(draft.id.value))
        assertEquals(file.imageCount, 3)
        val entries = zipEntries(file.bytes)
        assertEquals(
          entries.keySet,
          Set("01-total-assets.png", "02-revenue.jpg", "03-incident-log.webp"),
        )
        assertEquals(entries("01-total-assets.png"), TestImages.png1x1.toVector)
        assertEquals(entries("02-revenue.jpg"), revenueBytes.toVector)
        assertEquals(entries("03-incident-log.webp"), incidentBytes.toVector)
    }
  }

  test("archives only existing source images when some slots are missing") {
    tempDirectory("momo-api-source-image-archive-partial").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        totalAssets <- saveImage(imageStore, TestImages.png1x1, "image/png")
        incidentLog <- saveImage(imageStore, TestImages.webp(1, 1), "image/webp")
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        draft = draftWithImages(
          totalAssets = Some(totalAssets.imageId),
          revenue = None,
          incidentLog = Some(incidentLog.imageId),
          matchNo = None,
          playedAt = None,
          sourceImagesDeletedAt = None,
        )
        _ <- matchDrafts.create(draft)
        service = GetMatchDraftSourceImages[IO](matchDrafts, imageStore)
        archive <- service.archive(draft.id, accountId)
      yield
        val file = archive.getOrElse(fail("expected archive"))
        assertEquals(file.fileName, "momo-ocr-images-20260518.zip")
        assertEquals(file.imageCount, 2)
        assertEquals(
          zipEntries(file.bytes).keySet,
          Set("01-total-assets.png", "03-incident-log.webp"),
        )
    }
  }

  test("rejects oversized archives before reading image bytes") {
    val imageId = ImageId.unsafeFromString("image-too-large")
    val imageStore = NoReadImageStore(NoReadImageStore.storedPng(imageId, sizeBytes = 2L))

    for
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      draft = draftWithImages(
        totalAssets = Some(imageId),
        revenue = None,
        incidentLog = None,
        matchNo = None,
        playedAt = None,
        sourceImagesDeletedAt = None,
      )
      _ <- matchDrafts.create(draft)
      service =
        GetMatchDraftSourceImages[IO](matchDrafts, imageStore, sourceImageArchiveMaxBytes = 1L)
      archive <- service.archive(draft.id, accountId)
    yield archive match
      case Left(error: AppError.PayloadTooLarge) =>
        assert(error.detail.contains("archive is too large"))
      case other => fail(s"expected archive size rejection, got $other")
  }

  test("does not expose source image archives after retention is closed") {
    tempDirectory("momo-api-source-image-archive-deleted").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        totalAssets <- saveImage(imageStore, TestImages.png1x1, "image/png")
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        draft = draftWithImages(
          totalAssets = Some(totalAssets.imageId),
          revenue = None,
          incidentLog = None,
          matchNo = None,
          playedAt = None,
          sourceImagesDeletedAt = Some(Instant.parse("2026-05-18T13:00:00Z")),
        )
        _ <- matchDrafts.create(draft)
        service = GetMatchDraftSourceImages[IO](matchDrafts, imageStore)
        archive <- service.archive(draft.id, accountId)
      yield archive match
        case Left(AppError.NotFound(_, _)) => ()
        case other => fail(s"expected source images not found, got $other")
    }
  }

  test("forbids archive downloads from other accounts") {
    tempDirectory("momo-api-source-image-archive-forbidden").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        totalAssets <- saveImage(imageStore, TestImages.png1x1, "image/png")
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        draft = draftWithImages(
          totalAssets = Some(totalAssets.imageId),
          revenue = None,
          incidentLog = None,
          matchNo = None,
          playedAt = None,
          sourceImagesDeletedAt = None,
        )
        _ <- matchDrafts.create(draft)
        service = GetMatchDraftSourceImages[IO](matchDrafts, imageStore)
        archive <- service.archive(draft.id, otherAccountId)
      yield archive match
        case Left(AppError.Forbidden(_)) => ()
        case other => fail(s"expected forbidden, got $other")
    }
  }

  private def saveImage(
      imageStore: LocalFsImageStore[IO],
      bytes: Array[Byte],
      contentType: String,
  ): IO[StoredImage] = imageStore.save(accountId, None, Some(contentType), bytes).flatMap {
    case Right(image) => IO.pure(image)
    case Left(error) => fail(s"expected image to be stored: $error")
  }

  private def draftWithImages(
      totalAssets: Option[ImageId],
      revenue: Option[ImageId],
      incidentLog: Option[ImageId],
      matchNo: Option[Int],
      playedAt: Option[Instant],
      sourceImagesDeletedAt: Option[Instant],
  ): MatchDraft = MatchDraft.fromInputs(
    id = MatchDraftId.unsafeFromString("match-draft-archive-1"),
    createdByAccountId = accountId,
    createdByMemberId = Some(MemberId.unsafeFromString("member-1")),
    status = MatchDraftStatus.NeedsReview,
    heldEventId = None,
    matchNoInEvent = matchNo.map(MatchNoInEvent.unsafeFromInt),
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = playedAt,
    totalAssetsImageId = totalAssets,
    revenueImageId = revenue,
    incidentLogImageId = incidentLog,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = sourceImagesDeletedAt,
    sourceImagesDeletedAt = sourceImagesDeletedAt,
    confirmedMatchId = None,
    createdAt = createdAt,
    updatedAt = createdAt,
  ).getOrElse(fail("invalid draft fixture"))

  private def zipEntries(bytes: Array[Byte]): Map[String, Vector[Byte]] =
    val zip = ZipInputStream(ByteArrayInputStream(bytes))
    try
      @annotation.tailrec
      def readNext(result: Map[String, Vector[Byte]]): Map[String, Vector[Byte]] =
        Option(zip.getNextEntry) match
          case None => result
          case Some(entry) =>
            val out = ByteArrayOutputStream()
            zip.transferTo(out)
            zip.closeEntry()
            readNext(result.updated(entry.getName, out.toByteArray.toVector))

      readNext(Map.empty)
    finally zip.close()
