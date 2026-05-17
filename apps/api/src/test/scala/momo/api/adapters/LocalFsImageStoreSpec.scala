package momo.api.adapters

import java.nio.file.Files
import java.nio.file.attribute.FileTime
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.ImageId
import momo.api.errors.AppError
import momo.api.testing.TestImages

final class LocalFsImageStoreSpec extends MomoCatsEffectSuite:
  private val pngBytes: Array[Byte] = TestImages.png1x1

  test("stores PNG images after magic byte and content type validation") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      store.save(Some("sample.png"), Some("image/png"), pngBytes).flatMap {
        case Right(image) => IO.blocking(Files.exists(image.path)).assertEquals(true) *>
            IO(assertEquals(image.mediaType, "image/png")) *>
            IO(assertEquals(image.sizeBytes, pngBytes.length.toLong))
        case Left(error) => fail(s"expected image to be stored: $error")
      }
    }
  }

  test("stores JPEG images after magic byte and dimension validation") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      val bytes = TestImages.jpeg(width = 1280, height = 720)
      store.save(Some("sample.jpg"), Some("image/jpeg"), bytes).flatMap {
        case Right(image) => IO.blocking(Files.exists(image.path)).assertEquals(true) *>
            IO(assertEquals(image.mediaType, "image/jpeg")) *>
            IO(assertEquals(image.sizeBytes, bytes.length.toLong))
        case Left(error) => fail(s"expected image to be stored: $error")
      }
    }
  }

  test("stores WebP images after magic byte and dimension validation") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      val bytes = TestImages.webp(width = 1280, height = 720)
      store.save(Some("sample.webp"), Some("image/webp"), bytes).flatMap {
        case Right(image) => IO.blocking(Files.exists(image.path)).assertEquals(true) *>
            IO(assertEquals(image.mediaType, "image/webp")) *>
            IO(assertEquals(image.sizeBytes, bytes.length.toLong))
        case Left(error) => fail(s"expected image to be stored: $error")
      }
    }
  }

  test("rejects unsupported bytes") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      store.save(Some("sample.txt"), Some("text/plain"), Array[Byte](1, 2, 3)).map {
        case Left(error: AppError.UnsupportedMediaType) => assert(error.detail.contains("PNG"))
        case other => fail(s"expected unsupported media type, got $other")
      }
    }
  }

  test("rejects image bytes whose dimensions cannot be read") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      val headerOnlyPng = Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      store.save(Some("sample.png"), Some("image/png"), headerOnlyPng).map {
        case Left(error: AppError.UnsupportedMediaType) =>
          assert(error.detail.contains("dimensions"))
        case other => fail(s"expected unsupported media type, got $other")
      }
    }
  }

  test("rejects WebP containers without raster payload chunks") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      val canvasOnlyWebp = Array('R', 'I', 'F', 'F').map(_.toByte) ++ Array[Byte](22, 0, 0, 0) ++
        Array('W', 'E', 'B', 'P', 'V', 'P', '8', 'X').map(_.toByte) ++ Array[Byte](10, 0, 0, 0) ++
        Array.fill[Byte](10)(0.toByte)
      store.save(Some("canvas.webp"), Some("image/webp"), canvasOnlyWebp).map {
        case Left(error: AppError.UnsupportedMediaType) =>
          assert(error.detail.contains("dimensions"))
        case other => fail(s"expected unsupported media type, got $other")
      }
    }
  }

  test("rejects images larger than 3MB") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      val tooLarge = Array.fill[Byte](LocalFsImageStore.MaxBytes + 1)(0.toByte)
      store.save(Some("large.png"), Some("image/png"), tooLarge).map {
        case Left(error: AppError.PayloadTooLarge) =>
          assert(error.detail.contains(LocalFsImageStore.MaxBytes.toString))
        case other => fail(s"expected payload too large, got $other")
      }
    }
  }

  test("rejects images larger than 4K dimensions") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      val tooWide = TestImages.png(width = LocalFsImageStore.MaxWidth + 1, height = 1)
      store.save(Some("wide.png"), Some("image/png"), tooWide).map {
        case Left(error: AppError.PayloadTooLarge) =>
          assert(error.detail.contains(LocalFsImageStore.MaxDimensionsLabel))
        case other => fail(s"expected payload too large, got $other")
      }
    }
  }

  test("deletes stored images by image id") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      for
        stored <- store.save(Some("sample.png"), Some("image/png"), pngBytes).flatMap {
          case Right(image) => IO.pure(image)
          case Left(error) => fail(s"expected image to be stored: $error")
        }
        deleted <- store.delete(stored.imageId)
        existsAfter <- IO.blocking(Files.exists(stored.path))
      yield
        assertEquals(deleted, true)
        assertEquals(existsAfter, false)
    }
  }

  test("delete returns false when image does not exist") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      store.delete(ImageId.unsafeFromString("missing-image-id"))
        .map(deleted => assertEquals(deleted, false))
    }
  }

  test("deleteOrphans removes only old unreferenced source images") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      val now = Instant.parse("2026-05-08T12:00:00Z")
      val old = FileTime.from(now.minusSeconds(3600))
      val recent = FileTime.from(now.minusSeconds(10))
      val keptPath = dir.resolve("kept.png")
      val orphanPath = dir.resolve("orphan.png")
      val recentPath = dir.resolve("recent.png")
      for
        _ <- IO.blocking(Files.write(keptPath, pngBytes))
        _ <- IO.blocking(Files.write(orphanPath, pngBytes))
        _ <- IO.blocking(Files.write(recentPath, pngBytes))
        _ <- IO.blocking(Files.setLastModifiedTime(keptPath, old))
        _ <- IO.blocking(Files.setLastModifiedTime(orphanPath, old))
        _ <- IO.blocking(Files.setLastModifiedTime(recentPath, recent))
        deleted <- store.deleteOrphans(Set(ImageId.unsafeFromString("kept")), now.minusSeconds(60))
        keptExists <- IO.blocking(Files.exists(keptPath))
        orphanExists <- IO.blocking(Files.exists(orphanPath))
        recentExists <- IO.blocking(Files.exists(recentPath))
      yield
        assertEquals(deleted, 1)
        assert(keptExists)
        assert(!orphanExists)
        assert(recentExists)
    }
  }
