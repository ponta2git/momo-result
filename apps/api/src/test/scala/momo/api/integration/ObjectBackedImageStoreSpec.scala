package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.adapters.postgres.PostgresSourceImagesRepository
import momo.api.adapters.storage.objectstore.ObjectBackedImageStore
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.storage.*
import momo.api.repositories.SourceImageStatus
import momo.api.testing.{RecordingSourceImageObjectStorage, TestImages}

final class ObjectBackedImageStoreSpec extends IntegrationSuite:
  private val now = Instant.parse("2026-08-12T00:00:00Z")
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val imageId = ImageId.unsafeFromString("source-object-store")
  private val idempotencyHash = SourceImageIdempotencyHash.fromRawKey("upload-key-1")

  test("idempotent save converges on one object and supports read and delete"):
    for
      objects <- RecordingSourceImageObjectStorage.create
      store = imageStore(objects)
      first <- store.saveIdempotent(
        accountId,
        Some("source.png"),
        Some("image/png"),
        TestImages.png1x1,
        idempotencyHash,
      )
      second <- store.saveIdempotent(
        accountId,
        Some("source.png"),
        Some("image/png"),
        TestImages.png1x1,
        idempotencyHash,
      )
      stored <- first.fold(error => fail(s"expected stored image, got $error"), IO.pure)
      downloaded <- store.readStream(stored).compile.to(Array)
      putCount <- objects.putCount
      deleted <- store.delete(stored.imageId)
      deletedAgain <- store.delete(stored.imageId)
    yield
      assertEquals(second.map(_.imageId), Right(stored.imageId))
      assertEquals(downloaded.toList, TestImages.png1x1.toList)
      assertEquals(putCount, 1)
      assert(deleted)
      assert(!deletedAgain)

  test("same idempotency key with a different valid image is rejected before a second put"):
    val firstBytes = TestImages.png(width = 1, height = 1)
    val differentBytes = TestImages.png(width = 2, height = 1)

    for
      objects <- RecordingSourceImageObjectStorage.create
      store = imageStore(objects)
      first <- store.saveIdempotent(
        accountId,
        None,
        Some("image/png"),
        firstBytes,
        idempotencyHash,
      )
      second <- store.saveIdempotent(
        accountId,
        None,
        Some("image/png"),
        differentBytes,
        idempotencyHash,
      )
      putCount <- objects.putCount
    yield
      assert(first.isRight)
      second match
        case Left(_: AppError.IdempotencyPayloadMismatch) => ()
        case other => fail(s"expected payload mismatch, got $other")
      assertEquals(putCount, 1)

  test("failed put is retried forward from FAILED without Python or local storage fallback"):
    for
      objects <- RecordingSourceImageObjectStorage.create
      _ <- objects.failNextPut(SourceImageObjectFailure.Unavailable)
      store = imageStore(objects)
      first <- store.saveIdempotent(
        accountId,
        None,
        Some("image/png"),
        TestImages.png1x1,
        idempotencyHash,
      )
      failedRow <- PostgresSourceImagesRepository[IO](transactor).find(imageId)
      second <- store.saveIdempotent(
        accountId,
        None,
        Some("image/png"),
        TestImages.png1x1,
        idempotencyHash,
      )
      availableRow <- PostgresSourceImagesRepository[IO](transactor).find(imageId)
      putCount <- objects.putCount
    yield
      first match
        case Left(_: AppError.ServiceUnavailable) => ()
        case other => fail(s"expected storage unavailable, got $other")
      assertEquals(failedRow.map(_.status), Some(SourceImageStatus.Failed))
      assert(second.isRight)
      assertEquals(availableRow.map(_.status), Some(SourceImageStatus.Available))
      assertEquals(putCount, 2)

  test("read recomputes the DB checksum and rejects a tampered object"):
    for
      objects <- RecordingSourceImageObjectStorage.create
      store = imageStore(objects)
      saved <- store.saveIdempotent(
        accountId,
        None,
        Some("image/png"),
        TestImages.png1x1,
        idempotencyHash,
      )
      stored <- saved.fold(error => fail(s"expected stored image, got $error"), IO.pure)
      _ <- objects.tamper(stored.location.value, TestImages.png(width = 2, height = 1))
      result <- store.readStream(stored).compile.to(Array).attempt
    yield result match
      case Left(error: AppException) =>
        assertEquals(error.error.code, "DEPENDENCY_FAILED")
      case other => fail(s"expected integrity failure, got $other")

  private def imageStore(objects: SourceImageObjectStorage[IO]): ObjectBackedImageStore[IO] =
    ObjectBackedImageStore[IO](
      PostgresSourceImagesRepository[IO](transactor),
      objects,
      IO.pure(imageId),
      IO.pure(now),
    )
