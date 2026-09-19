package momo.api.usecases.matchdrafts

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}
import java.time.Instant
import java.util.zip.ZipInputStream

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.InMemoryMatchDraftsRepository
import momo.api.adapters.storage.local.LocalFsImageStore
import momo.api.domain.ids.*
import momo.api.domain.{MatchDraft, MatchDraftStatus, MatchNoInEvent, StoredImage}
import momo.api.errors.AppError
import momo.api.testing.{NoReadImageStore, TestImages}

final class GetMatchDraftSourceImagesSpec extends MomoCatsEffectSuite:
  private val accountId = AccountId.unsafeFromString("account-1")
  private val otherAccountId = AccountId.unsafeFromString("account-2")
  private val createdAt = Instant.parse("2026-05-17T23:59:00Z")
  private val playedAt = Instant.parse("2026-05-17T23:30:00Z")

  test("pinned downloads reject replaced images while legacy downloads use the current slot") {
    tempDirectory("momo-api-source-image-versions").use { dir =>
      for
        imageStore <- IO.pure(LocalFsImageStore[IO](dir))
        original <- saveImage(imageStore, TestImages.png1x1, "image/png")
        replacementBytes = TestImages.jpeg(1, 1)
        replacement <- saveImage(imageStore, replacementBytes, "image/jpeg")
        matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
        draft = draftWithImages(Some(original.imageId), None, None, None, None, None)
        _ <- matchDrafts.create(draft)
        service = GetMatchDraftSourceImages[IO](matchDrafts, imageStore)
        kind = MatchDraftSourceImageKind.TotalAssets
        before <- service.list(draft.id)
        pinned <- service.stream(draft.id, kind, Some(original.imageId))
        replaced = draft.withCommon(_.copy(totalAssetsImageId = Some(replacement.imageId)))
        _ <- matchDrafts.update(replaced, createdAt.plusSeconds(1))
        stale <- service.stream(draft.id, kind, Some(original.imageId))
        current <- service.stream(draft.id, kind, Some(replacement.imageId))
        legacy <- service.stream(draft.id, kind, None)
        originalBody <- expectImage(pinned).flatMap(_.body.compile.toVector)
        currentBody <- expectImage(current).flatMap(_.body.compile.toVector)
        legacyBody <- expectImage(legacy).flatMap(_.body.compile.toVector)
        staleArchive <- service.archive(draft.id, accountId, Some(createdAt))
        currentArchive <- service.archive(draft.id, accountId, Some(createdAt.plusSeconds(1)))
        archiveBody <- expectArchive(currentArchive).flatMap(_.body.compile.to(Array))
      yield
        assertEquals(before.map(_.map(_.imageId)), Right(List(original.imageId)))
        assertEquals(stale.swap.toOption.map(_.code), Some("CONFLICT"))
        assertEquals(originalBody, TestImages.png1x1.toVector)
        assertEquals(currentBody, replacementBytes.toVector)
        assertEquals(legacyBody, replacementBytes.toVector)
        assertEquals(staleArchive.swap.toOption.map(_.code), Some("CONFLICT"))
        assertEquals(
          zipEntries(archiveBody),
          Map("01-total-assets.jpg" -> replacementBytes.toVector)
        )
    }
  }

  test("image version pins do not bypass closed retention or missing slots") {
    val imageId = ImageId.unsafeFromString("retained-image")
    val imageStore = NoReadImageStore(NoReadImageStore.storedPng(imageId, sizeBytes = 1L))
    for
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      draft = draftWithImages(Some(imageId), None, None, None, None, Some(createdAt))
      _ <- matchDrafts.create(draft)
      service = GetMatchDraftSourceImages[IO](matchDrafts, imageStore)
      closed <- service.stream(draft.id, MatchDraftSourceImageKind.TotalAssets, Some(imageId))
      archive <- service.archive(draft.id, accountId, Some(createdAt))
      _ <- matchDrafts.update(draft.withCommon(_.copy(sourceImagesDeletedAt = None)), createdAt)
      missing <- service.stream(draft.id, MatchDraftSourceImageKind.Revenue, Some(imageId))
    yield
      assertEquals(closed.swap.toOption.map(_.code), Some("NOT_FOUND"))
      assertEquals(archive.swap.toOption.map(_.code), Some("NOT_FOUND"))
      assertEquals(missing.swap.toOption.map(_.code), Some("NOT_FOUND"))
  }

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
        archive <- service.archive(draft.id, accountId, None)
        file <- expectArchive(archive)
        bytes <- file.body.compile.to(Array)
      yield
        assertEquals(file.contentType, "application/zip")
        assertEquals(file.fileName, "momo-ocr-images-20260518-match-03.zip")
        assert(!file.fileName.contains(draft.id.value))
        assertEquals(file.imageCount, 3)
        val entries = zipEntries(bytes)
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
        archive <- service.archive(draft.id, accountId, None)
        file <- expectArchive(archive)
        bytes <- file.body.compile.to(Array)
      yield
        assertEquals(file.fileName, "momo-ocr-images-20260518.zip")
        assertEquals(file.imageCount, 2)
        assertEquals(
          zipEntries(bytes).keySet,
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
      archive <- service.archive(draft.id, accountId, None)
    yield archive match
      case Left(error: AppError.PayloadTooLarge) =>
        assert(error.detail.contains("archive is too large"))
      case other => fail(s"expected archive size rejection, got $other")
  }

  test("rejects archives whose zipped response exceeds the configured byte limit") {
    tempDirectory("momo-api-source-image-archive-zipped-too-large").use { dir =>
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
        service = GetMatchDraftSourceImages[IO](
          matchDrafts,
          imageStore,
          sourceImageArchiveMaxBytes = totalAssets.sizeBytes,
        )
        archive <- service.archive(draft.id, accountId, None)
      yield archive match
        case Left(error: AppError.PayloadTooLarge) =>
          assert(error.detail.contains("archive is too large"))
        case other => fail(s"expected zipped archive size rejection, got $other")
    }
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
        archive <- service.archive(draft.id, accountId, None)
      yield archive match
        case Left(AppError.NotFound(_, _)) => ()
        case other => fail(s"expected source images not found, got $other")
    }
  }

  test("allows archive downloads from accounts that did not create the draft") {
    tempDirectory("momo-api-source-image-archive-non-owner").use { dir =>
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
        archive <- service.archive(draft.id, otherAccountId, None)
        file <- expectArchive(archive)
      yield assertEquals(file.imageCount, 1)
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

  private def expectArchive(
      result: Either[AppError, MatchDraftSourceImageArchive[IO]]
  ): IO[MatchDraftSourceImageArchive[IO]] = result match
    case Right(file) => IO.pure(file)
    case Left(error) => fail(s"expected archive: $error")

  private def expectImage(
      result: Either[AppError, MatchDraftSourceImageBinary[IO]]
  ): IO[MatchDraftSourceImageBinary[IO]] = result match
    case Right(image) => IO.pure(image)
    case Left(error) => fail(s"expected image: $error")
