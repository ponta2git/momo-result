package momo.api.adapters

import java.nio.file.Files

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.ImageId
import momo.api.errors.AppError

final class LocalFsImageStoreSpec extends MomoCatsEffectSuite:
  private val pngBytes: Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

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

  test("rejects unsupported bytes") {
    tempDirectory("momo-api-image-store").use { dir =>
      val store = LocalFsImageStore[IO](dir)
      store.save(Some("sample.txt"), Some("text/plain"), Array[Byte](1, 2, 3)).map {
        case Left(error: AppError.UnsupportedMediaType) => assert(error.detail.contains("PNG"))
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
      store.delete(ImageId("missing-image-id")).map(deleted => assertEquals(deleted, false))
    }
  }
