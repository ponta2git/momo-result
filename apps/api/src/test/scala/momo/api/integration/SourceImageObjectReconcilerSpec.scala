package momo.api.integration

import java.time.Instant

import scala.concurrent.duration.DurationInt

import cats.effect.{Deferred, IO, Ref}
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.{
  PostgresMatchDraftCancellationRepository,
  PostgresSourceImagesRepository
}
import momo.api.adapters.storage.objectstore.{
  ObjectBackedImageStore,
  SourceImageObjectReconciler,
  SourceImageObjectReconcilerConfig
}
import momo.api.domain.ids.{AccountId, ImageId, MatchDraftId}
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
import momo.api.usecases.matchdrafts.CancelMatchDraft

final class SourceImageObjectReconcilerSpec extends IntegrationSuite:
  private val now = Instant.parse("2026-08-12T00:00:00Z")
  private val old = now.minusSeconds(7200)
  private val accountId = AccountId.unsafeFromString("account_ponta")
  private val bytes = TestImages.png1x1
  private val quota = SourceImageQuota(1000, Long.MaxValue)
  private val config = SourceImageObjectReconcilerConfig(
    staleStateAge = 1.minute,
    orphanAge = 1.hour,
    failedRecordRetention = 1.hour,
    batchSize = 100,
  )

  test("a stale RESERVED row with an intact object is recovered as AVAILABLE"):
    val candidate = reservation("source-reconcile-reserved", old)
    for
      objects <- RecordingSourceImageObjectStorage.create
      repository = PostgresSourceImagesRepository[IO](transactor)
      _ <- repository.reserveWithinQuota(candidate, quota)
      put <- objects.put(candidate.objectKey, candidate.mediaType, bytes, candidate.sha256)
      _ = assert(put.isRight)
      stats <- reconciler(repository, objects).flatMap(_.runOnce)
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
      stats <- reconciler(repository, objects).flatMap(_.runOnce)
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
      stats <- reconciler(repository, objects).flatMap(_.runOnce)
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

  test("bounded sweeps pass a failing head, finish their fixed window, and retry from the start"):
    val head = reservation("source-state-a", old)
    val tail = reservation("source-state-b", old)
    val newerState = reservation("source-state-c", now)
    val orphanHead = reservation("source-orphan-a", old)
    val orphanTail = reservation("source-orphan-b", old)
    val newerOrphan = reservation("source-orphan-c", now)
    val repository = PostgresSourceImagesRepository[IO](transactor)

    for
      objects <- RecordingSourceImageObjectStorage.create
      _ <- List(head, tail, newerState, orphanHead, orphanTail, newerOrphan).traverse_ { candidate =>
        repository.reserveWithinQuota(candidate, quota) *>
          objects.put(candidate.objectKey, candidate.mediaType, bytes, candidate.sha256)
      }
      _ <- List(tail, newerState, orphanHead, orphanTail, newerOrphan).traverse_ { candidate =>
        repository.markAvailable(candidate.id, None, candidate.now)
      }
      _ <- List(tail, newerState).traverse_ { candidate =>
        repository.beginDeleteUnreferenced(candidate.id, candidate.now)
      }
      clock <- Ref.of[IO, Instant](now)
      sweep <- SourceImageObjectReconciler.create[IO](
        repository,
        objects,
        config.copy(batchSize = 1),
        clock.get,
      )
      _ <- objects.failNextGet(SourceImageObjectFailure.Unavailable)
      first <- sweep.runOnce
      firstHead <- repository.find(head.id)
      firstOrphan <- repository.find(orphanHead.id)
      untouchedOrphan <- repository.find(orphanTail.id)
      _ <- clock.set(now.plusSeconds(7200))
      // Keep the outage armed while the next page progresses; the next GET is the head on run 3.
      _ <- objects.failNextGet(SourceImageObjectFailure.Unavailable)
      second <- sweep.runOnce
      secondTail <- repository.find(tail.id)
      secondOrphan <- repository.find(orphanTail.id)
      waitingState <- repository.find(newerState.id)
      waitingOrphan <- repository.find(newerOrphan.id)
      third <- sweep.runOnce
      retriedHead <- repository.find(head.id)
      admittedOrphan <- repository.find(newerOrphan.id)
      fourth <- sweep.runOnce
      admittedState <- repository.find(newerState.id)
      recovered <- sweep.runOnce
      recoveredHead <- repository.find(head.id)
    yield
      assertEquals(first.deferred, 1)
      assertEquals(first.deleted, 1)
      assertEquals(firstHead.map(_.status), Some(SourceImageStatus.Reserved))
      assertEquals(firstOrphan.map(_.status), Some(SourceImageStatus.Deleted))
      assertEquals(untouchedOrphan.map(_.status), Some(SourceImageStatus.Available))
      assertEquals(second.deleted, 2)
      assertEquals(secondTail.map(_.status), Some(SourceImageStatus.Deleted))
      assertEquals(secondOrphan.map(_.status), Some(SourceImageStatus.Deleted))
      assertEquals(waitingState.map(_.status), Some(SourceImageStatus.DeletePending))
      assertEquals(waitingOrphan.map(_.status), Some(SourceImageStatus.Available))
      assertEquals(third.deferred, 1)
      assertEquals(third.deleted, 1)
      assertEquals(retriedHead.map(_.status), Some(SourceImageStatus.Reserved))
      assertEquals(admittedOrphan.map(_.status), Some(SourceImageStatus.Deleted))
      assertEquals(fourth.deleted, 1)
      assertEquals(admittedState.map(_.status), Some(SourceImageStatus.Deleted))
      assertEquals(recovered.recovered, 1)
      assertEquals(recoveredHead.map(_.status), Some(SourceImageStatus.Available))

  test("cancellation leaves an inaccessible object charged to quota until later reconciliation"):
    val candidate = reservation("source-cancel-reconcile", old)
    val next = reservation("source-after-cancel-reconcile", now)
    val draftId = MatchDraftId.unsafeFromString("draft-cancel-reconcile")
    val singleImageQuota = SourceImageQuota(1, Long.MaxValue)
    val repository = PostgresSourceImagesRepository[IO](transactor)

    for
      objects <- RecordingSourceImageObjectStorage.create
      _ <- repository.reserveWithinQuota(candidate, singleImageQuota)
      _ <- objects.put(candidate.objectKey, candidate.mediaType, bytes, candidate.sha256)
      _ <- repository.markAvailable(candidate.id, None, old)
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status, total_assets_image_id,
          created_at, updated_at
        ) VALUES ($draftId, $accountId, 'member_ponta', 'draft_ready', ${candidate.id}, $old, $old)
      """.update.run.transact(transactor)
      store =
        ObjectBackedImageStore[IO](repository, objects, IO.pure(candidate.id), IO.pure(old), quota)
      visibleBefore <- store.find(candidate.id)
      cancelled <- CancelMatchDraft[IO](
        PostgresMatchDraftCancellationRepository[IO](transactor),
        IO.pure(old),
      ).run(draftId, accountId)
      pending <- repository.find(candidate.id)
      visibleAfter <- store.find(candidate.id)
      retained <- objects.contains(candidate.objectKey)
      blocked <- repository.reserveWithinQuota(next, singleImageQuota)
      _ <- objects.failNextDelete(SourceImageObjectFailure.Unavailable)
      deferred <- reconciler(repository, objects).flatMap(_.runOnce)
      afterFailure <- repository.find(candidate.id)
      retainedAfterFailure <- objects.contains(candidate.objectKey)
      restartedRepository = PostgresSourceImagesRepository[IO](transactor)
      recovered <- reconciler(restartedRepository, objects).flatMap(_.runOnce)
      deleted <- restartedRepository.find(candidate.id)
      remains <- objects.contains(candidate.objectKey)
      admitted <- restartedRepository.reserveWithinQuota(next, singleImageQuota)
    yield
      assert(visibleBefore.nonEmpty)
      assertEquals(cancelled, Right(()))
      assertEquals(pending.map(_.status), Some(SourceImageStatus.DeletePending))
      assertEquals(visibleAfter, None)
      assert(retained)
      assertEquals(
        blocked,
        SourceImageReservationResult.Rejected(
          SourceImageQuotaRejection.CountExceeded(2L, 1)
        )
      )
      assertEquals(deferred.deferred, 1)
      assertEquals(afterFailure.map(_.status), Some(SourceImageStatus.DeletePending))
      assert(retainedAfterFailure)
      assertEquals(recovered.deleted, 1)
      assertEquals(deleted.map(_.status), Some(SourceImageStatus.Deleted))
      assert(!remains)
      admitted match
        case SourceImageReservationResult.Reserved(image) => assertEquals(image.id, next.id)
        case other => fail(s"expected quota to be released after deletion, got $other")

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
      reconciliation <- reconciler(repository, gated).flatMap(_.runOnce).start
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
  ): IO[SourceImageObjectReconciler[IO]] = SourceImageObjectReconciler.create[IO](
    repository,
    objects,
    config,
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
