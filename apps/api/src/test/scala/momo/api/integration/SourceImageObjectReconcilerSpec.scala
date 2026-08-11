package momo.api.integration

import java.time.Instant

import scala.concurrent.duration.DurationInt

import cats.effect.IO

import momo.api.adapters.postgres.PostgresSourceImagesRepository
import momo.api.adapters.storage.objectstore.{
  SourceImageObjectReconciler,
  SourceImageObjectReconcilerConfig
}
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{
  Sha256Hex,
  SourceImageIdempotencyHash,
  SourceImageObjectFailure,
  SourceImageObjectKey
}
import momo.api.repositories.*
import momo.api.testing.{RecordingSourceImageObjectStorage, TestImages}

final class SourceImageObjectReconcilerSpec extends IntegrationSuite:
  private val now = Instant.parse("2026-08-12T00:00:00Z")
  private val old = now.minusSeconds(7200)
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val bytes = TestImages.png1x1

  test("a stale RESERVED row with an intact object is recovered as AVAILABLE"):
    val candidate = reservation("source-reconcile-reserved", old)
    for
      objects <- RecordingSourceImageObjectStorage.create
      repository = PostgresSourceImagesRepository[IO](transactor)
      _ <- repository.reserve(candidate)
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
      _ <- repository.reserve(missing)
      _ <- repository.reserve(purge)
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
      _ <- repository.reserve(orphan)
      _ <- repository.reserve(pending)
      _ <- objects.put(orphan.objectKey, orphan.mediaType, bytes, orphan.sha256)
      _ <- objects.put(pending.objectKey, pending.mediaType, bytes, pending.sha256)
      _ <- repository.markAvailable(orphan.id, None, old)
      _ <- repository.markAvailable(pending.id, None, old)
      _ <- repository.beginDelete(pending.id, old)
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
      _ <- repository.reserve(candidate)
      _ <- objects.failNextGet(SourceImageObjectFailure.Unavailable)
      stats <- reconciler(repository, objects).runOnce
      stored <- repository.find(candidate.id)
    yield
      assertEquals(stats.deferred, 1)
      assertEquals(stored.map(_.status), Some(SourceImageStatus.Reserved))

  private def reconciler(
      repository: SourceImagesRepository[IO],
      objects: RecordingSourceImageObjectStorage,
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
