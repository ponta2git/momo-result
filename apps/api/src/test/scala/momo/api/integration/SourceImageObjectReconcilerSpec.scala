package momo.api.integration

import java.time.Instant

import scala.concurrent.duration.DurationInt

import cats.effect.{Deferred, IO, Ref}

import momo.api.adapters.postgres.PostgresSourceImagesRepository
import momo.api.adapters.storage.objectstore.{
  SourceImageObjectReconciler,
  SourceImageObjectReconcilerConfig
}
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{
  Sha256Hex,
  SourceImageIdempotencyHash,
  SourceImageObject,
  SourceImageObjectFailure,
  SourceImageObjectKey,
  SourceImageObjectMetadata,
  SourceImageObjectStorage
}
import momo.api.repositories.*
import momo.api.testing.{RecordingSourceImageObjectStorage, TestImages}

final class SourceImageObjectReconcilerSpec extends IntegrationSuite:
  private val now = Instant.parse("2026-08-12T00:00:00Z")
  private val old = now.minusSeconds(7200)
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val bytes = TestImages.png1x1
  private val quota = SourceImageQuota(1000, Long.MaxValue)

  test("a stale RESERVED row with an intact object is recovered as AVAILABLE"):
    val candidate = reservation("source-reconcile-reserved", old)
    for
      objects <- RecordingSourceImageObjectStorage.create
      repository = PostgresSourceImagesRepository[IO](transactor)
      _ <- repository.reserveWithinQuota(candidate, quota)
      put <- objects.put(candidate.objectKey, candidate.mediaType, bytes, candidate.sha256)
      _ = assert(put.isRight)
      stats <- reconciler(repository, objects).runOnce
      stored <- repository.find(candidate.id)
    yield
      assertEquals(stats.recovered, 1)
      assertEquals(stored.map(_.status), Some(SourceImageStatus.Available))

  test("a stale missing reservation is marked FAILED and a much older FAILED row is purged"):
    val missing = reservation("source-reconcile-missing", old)
    val purge = reservation("source-reconcile-purge", old)
    val repository = PostgresSourceImagesRepository[IO](transactor)

    for
      objects <- RecordingSourceImageObjectStorage.create
      _ <- repository.reserveWithinQuota(missing, quota)
      _ <- repository.reserveWithinQuota(purge, quota)
      _ <- repository.markUploadFailed(
        purge.id,
        SourceImageFailureCode.ObjectMissing,
        old,
      )
      stats <- reconciler(repository, objects).runOnce
      missingRow <- repository.find(missing.id)
      purgedRow <- repository.find(purge.id)
    yield
      assertEquals(stats.markedFailed, 1)
      assertEquals(stats.purgedFailed, 1)
      assertEquals(missingRow.map(_.status), Some(SourceImageStatus.Failed))
      assertEquals(missingRow.flatMap(_.failureCode), Some(SourceImageFailureCode.ObjectMissing))
      assertEquals(purgedRow, None)

  test("unreferenced AVAILABLE objects and interrupted DELETE_PENDING objects are deleted"):
    val orphan = reservation("source-reconcile-orphan", old)
    val pending = reservation("source-reconcile-pending", old)
    val repository = PostgresSourceImagesRepository[IO](transactor)

    for
      objects <- RecordingSourceImageObjectStorage.create
      _ <- repository.reserveWithinQuota(orphan, quota)
      _ <- repository.reserveWithinQuota(pending, quota)
      _ <- objects.put(orphan.objectKey, orphan.mediaType, bytes, orphan.sha256)
      _ <- objects.put(pending.objectKey, pending.mediaType, bytes, pending.sha256)
      _ <- repository.markAvailable(orphan.id, None, old)
      _ <- repository.markAvailable(pending.id, None, old)
      _ <- repository.beginDeleteUnreferenced(pending.id, old)
      stats <- reconciler(repository, objects).runOnce
      orphanRow <- repository.find(orphan.id)
      pendingRow <- repository.find(pending.id)
      orphanExists <- objects.contains(orphan.objectKey)
      pendingExists <- objects.contains(pending.objectKey)
    yield
      assertEquals(stats.deleted, 2)
      assertEquals(orphanRow.map(_.status), Some(SourceImageStatus.Deleted))
      assertEquals(pendingRow.map(_.status), Some(SourceImageStatus.Deleted))
      assert(!orphanExists)
      assert(!pendingExists)

  test("provider outages defer reconciliation without changing the DB state"):
    val candidate = reservation("source-reconcile-deferred", old)
    val repository = PostgresSourceImagesRepository[IO](transactor)

    for
      objects <- RecordingSourceImageObjectStorage.create
      _ <- repository.reserveWithinQuota(candidate, quota)
      _ <- objects.failNextGet(SourceImageObjectFailure.Unavailable)
      stats <- reconciler(repository, objects).runOnce
      stored <- repository.find(candidate.id)
    yield
      assertEquals(stats.deferred, 1)
      assertEquals(stored.map(_.status), Some(SourceImageStatus.Reserved))

  test("a retry that wins after FAILED inspection prevents deletion of the replacement object"):
    val candidate = reservation("source-reconcile-retry-race", old)
    val repository = PostgresSourceImagesRepository[IO](transactor)

    for
      objects <- RecordingSourceImageObjectStorage.create
      _ <- repository.reserveWithinQuota(candidate, quota)
      _ <- objects.put(candidate.objectKey, candidate.mediaType, bytes, candidate.sha256)
      _ <- objects.tamper(candidate.objectKey.value, TestImages.png(width = 2, height = 1))
      _ <- repository.markUploadFailed(
        candidate.id,
        SourceImageFailureCode.ObjectIntegrityViolation,
        old,
      )
      inspected <- Deferred[IO, Unit]
      releaseInspection <- Deferred[IO, Unit]
      firstGet <- Ref.of[IO, Boolean](true)
      gated = gateAfterFirstGet(objects, inspected, releaseInspection, firstGet)
      reconciliation <- reconciler(repository, gated).runOnce.start
      _ <- inspected.get
      store = momo.api.adapters.storage.objectstore.ObjectBackedImageStore[IO](
        repository,
        gated,
        IO.pure(candidate.id),
        IO.pure(now),
        quota,
      )
      retried <- store.saveIdempotent(
        accountId,
        None,
        Some(candidate.mediaType),
        bytes,
        candidate.idempotencyKeyHash,
      )
      _ <- releaseInspection.complete(())
      stats <- reconciliation.joinWithNever
      stored <- repository.find(candidate.id)
      replacement <- objects.get(candidate.objectKey)
    yield
      assert(retried.isRight)
      assertEquals(stats.deferred, 1)
      assertEquals(stored.map(_.status), Some(SourceImageStatus.Available))
      replacement match
        case Right(sourceObject) => assertEquals(sourceObject.bytes.toList, bytes.toList)
        case Left(error) => fail(s"expected replacement object, got $error")

  private def reconciler(
      repository: SourceImagesRepository[IO],
      objects: SourceImageObjectStorage[IO],
  ): SourceImageObjectReconciler[IO] = SourceImageObjectReconciler[IO](
    repository,
    objects,
    SourceImageObjectReconcilerConfig(
      staleStateAge = 1.minute,
      orphanAge = 1.hour,
      failedRecordRetention = 1.hour,
      batchSize = 100,
    ),
    IO.pure(now),
  )

  private def gateAfterFirstGet(
      delegate: SourceImageObjectStorage[IO],
      inspected: Deferred[IO, Unit],
      release: Deferred[IO, Unit],
      firstGet: Ref[IO, Boolean],
  ): SourceImageObjectStorage[IO] = new SourceImageObjectStorage[IO]:
    override def put(
        key: SourceImageObjectKey,
        mediaType: String,
        bytes: Array[Byte],
        sha256: Sha256Hex,
    ): IO[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] =
      delegate.put(key, mediaType, bytes, sha256)

    override def head(
        key: SourceImageObjectKey
    ): IO[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] = delegate.head(key)

    override def get(
        key: SourceImageObjectKey
    ): IO[Either[SourceImageObjectFailure, SourceImageObject]] = delegate.get(key).flatTap(_ =>
      firstGet.getAndSet(false).flatMap {
        case true => inspected.complete(()) *> release.get
        case false => IO.unit
      }
    )

    override def delete(
        key: SourceImageObjectKey
    ): IO[Either[SourceImageObjectFailure, Unit]] = delegate.delete(key)

  private def reservation(id: String, timestamp: Instant): SourceImageReservation =
    val imageId = ImageId.unsafeFromString(id)
    SourceImageReservation(
      id = imageId,
      ownerAccountId = accountId,
      objectKey = SourceImageObjectKey.forImage(imageId, "png").fold(fail(_), identity),
      idempotencyKeyHash = SourceImageIdempotencyHash.fromRawKey(s"key-$id"),
      mediaType = "image/png",
      sizeBytes = bytes.length.toLong,
      sha256 = Sha256Hex.digest(bytes),
      width = 1,
      height = 1,
      now = timestamp,
    )
