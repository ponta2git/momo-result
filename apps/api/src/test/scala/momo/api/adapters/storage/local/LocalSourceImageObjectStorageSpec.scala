package momo.api.adapters.storage.local

import java.nio.file.{Files, StandardOpenOption}

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.ImageId
import momo.api.ports.storage.{Sha256Hex, SourceImageObjectFailure, SourceImageObjectKey}
import momo.api.testing.TestImages

final class LocalSourceImageObjectStorageSpec extends MomoCatsEffectSuite:
  private val key = SourceImageObjectKey
    .forImage(ImageId.unsafeFromString("018f50e2-88aa-7d1d-a8a6-9f3f8cf58d90"), "png")
    .fold(fail(_), identity)
  private val bytes = TestImages.png1x1
  private val sha256 = Sha256Hex.digest(bytes)

  test("put, head, get, and idempotent delete preserve the opaque object contract"):
    tempDirectory("momo-local-source-objects").use { directory =>
      val storage = LocalSourceImageObjectStorage[IO](directory)
      for
        put <- storage.put(key, "image/png", bytes, sha256)
        putAgain <- storage.put(key, "image/png", bytes, sha256)
        head <- storage.head(key)
        get <- storage.get(key)
        diskUsage <- storage.diskUsage
        storedPathExists <- IO.blocking(Files.isRegularFile(directory.resolve(key.value)))
        deleted <- storage.delete(key)
        deletedAgain <- storage.delete(key)
        missing <- storage.get(key)
      yield
        assertEquals(put.map(_.sha256), Right(sha256))
        assertEquals(putAgain, put)
        assertEquals(head, put)
        assertEquals(get.map(_.metadata), put)
        assertEquals(get.map(_.bytes.toList), Right(bytes.toList))
        assert(diskUsage.exists(usage => usage.totalBytes > 0L && usage.usableBytes > 0L))
        assert(storedPathExists)
        assertEquals(deleted, Right(()))
        assertEquals(deletedAgain, Right(()))
        assertEquals(missing, Left(SourceImageObjectFailure.NotFound))
    }

  test("put rejects a checksum mismatch before creating an object"):
    tempDirectory("momo-local-source-objects").use { directory =>
      val storage = LocalSourceImageObjectStorage[IO](directory)
      val wrongSha256 = Sha256Hex.digest(Array[Byte](1, 2, 3))

      for
        result <- storage.put(key, "image/png", bytes, wrongSha256)
        objectExists <- IO.blocking(Files.exists(directory.resolve(key.value)))
      yield
        assertEquals(result, Left(SourceImageObjectFailure.IntegrityViolation))
        assert(!objectExists)
    }

  test("an existing object cannot be overwritten with a different payload"):
    tempDirectory("momo-local-source-objects").use { directory =>
      val storage = LocalSourceImageObjectStorage[IO](directory)
      val differentBytes = TestImages.png(width = 2, height = 1)

      for
        stored <- storage.put(key, "image/png", bytes, sha256)
        _ = assert(stored.isRight)
        overwrite <- storage.put(
          key,
          "image/png",
          differentBytes,
          Sha256Hex.digest(differentBytes),
        )
        current <- storage.get(key)
      yield
        assertEquals(overwrite, Left(SourceImageObjectFailure.IntegrityViolation))
        assertEquals(current.map(_.bytes.toList), Right(bytes.toList))
    }

  test("get rejects malformed or truncated object bytes"):
    tempDirectory("momo-local-source-objects").use { directory =>
      val storage = LocalSourceImageObjectStorage[IO](directory)
      val path = directory.resolve(key.value)

      for
        stored <- storage.put(key, "image/png", bytes, sha256)
        _ = assert(stored.isRight)
        _ <- IO.blocking {
          val _ = Files.write(
            path,
            Array[Byte](1, 2, 3),
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE,
          )
        }
        result <- storage.get(key)
      yield assertEquals(result, Left(SourceImageObjectFailure.IntegrityViolation))
    }

  test("put refuses to follow a symlink outside the configured object root"):
    tempDirectory("momo-local-source-objects").use { directory =>
      val objectRoot = directory.resolve("objects")
      val outside = directory.resolve("outside")
      val storage = LocalSourceImageObjectStorage[IO](objectRoot)

      for
        _ <- IO.blocking {
          Files.createDirectories(objectRoot)
          Files.createDirectories(outside)
          val _ = Files.createSymbolicLink(objectRoot.resolve("source-images"), outside)
        }
        result <- storage.put(key, "image/png", bytes, sha256)
        outsideObjects <- IO.blocking {
          val entries = Files.list(outside)
          try entries.count()
          finally entries.close()
        }
      yield
        assertEquals(result, Left(SourceImageObjectFailure.AccessDenied))
        assertEquals(outsideObjects, 0L)
    }
