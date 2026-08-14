package momo.api.integration

import java.time.Instant

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Ref, Resource}
import cats.syntax.all.*
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.{Level, Logger}
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory

import momo.api.adapters.postgres.PostgresSourceImagesRepository
import momo.api.adapters.storage.objectstore.ObjectBackedImageStore
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.storage.*
import momo.api.repositories.{SourceImageQuota, SourceImageStatus}
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

  test("concurrent uploads cannot overrun the account reservation quota"):
    val ids = (1 to 8).toVector.map(index => ImageId.unsafeFromString(s"source-quota-$index"))
    val quota = SourceImageQuota(unreferencedCountLimit = 2, unreferencedBytesLimit = Long.MaxValue)

    for
      objects <- RecordingSourceImageObjectStorage.create
      remaining <- Ref.of[IO, Vector[ImageId]](ids)
      nextId = remaining.modify {
        case head +: tail => tail -> Some(head)
        case _ => Vector.empty -> None
      }.flatMap(_.liftTo[IO](new IllegalStateException("test image ids exhausted")))
      store = ObjectBackedImageStore[IO](
        PostgresSourceImagesRepository[IO](transactor),
        objects,
        nextId,
        IO.pure(now),
        quota,
      )
      results <- (1 to 8).toList.parTraverse(index =>
        store.saveIdempotent(
          accountId,
          None,
          Some("image/png"),
          TestImages.png1x1,
          SourceImageIdempotencyHash.fromRawKey(s"quota-key-$index"),
        )
      )
      putCount <- objects.putCount
    yield
      assertEquals(results.count(_.isRight), 2)
      assertEquals(
        results.count {
          case Left(_: AppError.TooManyRequests) => true
          case _ => false
        },
        6
      )
      assertEquals(putCount, 2)

  test("atomic quota rejection preserves its bounded operational reason"):
    for
      objects <- RecordingSourceImageObjectStorage.create
      store = ObjectBackedImageStore[IO](
        PostgresSourceImagesRepository[IO](transactor),
        objects,
        IO.pure(ImageId.unsafeFromString("source-quota-observed")),
        IO.pure(now),
        SourceImageQuota(unreferencedCountLimit = 0, unreferencedBytesLimit = Long.MaxValue),
      )
      _ <- captureLogs { events =>
        store.saveIdempotent(
          accountId,
          None,
          Some("image/png"),
          TestImages.png1x1,
          SourceImageIdempotencyHash.fromRawKey("quota-observed"),
        ).flatMap { result =>
          events.map { captured =>
            assert(result match
              case Left(_: AppError.TooManyRequests) => true
              case _ => false)
            val messages = captured.map(_.getFormattedMessage)
            assertEquals(
              messages.count(_.startsWith("image_upload_admission rejected ")),
              1,
            )
            assert(messages.exists(_.contains("reason=unreferenced_count_exceeded")))
            assert(messages.exists(_.contains("countAfter=1 limit=0")))
          }
        }
      }
    yield ()

  private def imageStore(objects: SourceImageObjectStorage[IO]): ObjectBackedImageStore[IO] =
    ObjectBackedImageStore[IO](
      PostgresSourceImagesRepository[IO](transactor),
      objects,
      IO.pure(imageId),
      IO.pure(now),
      SourceImageQuota(1000, Long.MaxValue),
    )

  private def captureLogs[A](use: IO[Vector[ILoggingEvent]] => IO[A]): IO[A] =
    val logger =
      IO.delay(LoggerFactory.getLogger("momo.api.adapters.storage.ObjectBackedImageStore"))
        .flatMap {
          case logback: Logger => IO.pure(logback)
          case other => IO.raiseError(new IllegalStateException(
              s"Expected logback logger, got ${other.getClass.getName}"
            ))
        }
    Resource.make(logger.flatMap { logback =>
      IO.delay {
        val appender = new ListAppender[ILoggingEvent]()
        appender.start()
        val originalLevel = logback.getLevel
        logback.setLevel(Level.WARN)
        logback.addAppender(appender)
        (logback, appender, originalLevel)
      }
    }) { case (logback, appender, originalLevel) =>
      IO.delay {
        logback.detachAppender(appender)
        logback.setLevel(originalLevel)
        appender.stop()
      }
    }.use { case (_, appender, _) =>
      use(IO.delay(appender.list.asScala.toVector))
    }
