package momo.api.adapters.storage.objectstore

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.effect.Async
import cats.syntax.all.*

import momo.api.ports.storage.{SourceImageObjectFailure, SourceImageObjectStorage}
import momo.api.repositories.{
  SourceImageDeleteResult,
  SourceImageFailureCode,
  SourceImageRecord,
  SourceImageStatus,
  SourceImagesRepository
}

final case class SourceImageObjectReconcilerConfig(
    staleStateAge: FiniteDuration,
    orphanAge: FiniteDuration,
    failedRecordRetention: FiniteDuration,
    batchSize: Int,
)

final case class SourceImageObjectReconciliationStats(
    recovered: Int,
    markedFailed: Int,
    deleted: Int,
    purgedFailed: Int,
    deferred: Int,
    skipped: Int,
) derives CanEqual:
  def combine(other: SourceImageObjectReconciliationStats): SourceImageObjectReconciliationStats =
    SourceImageObjectReconciliationStats(
      recovered + other.recovered,
      markedFailed + other.markedFailed,
      deleted + other.deleted,
      purgedFailed + other.purgedFailed,
      deferred + other.deferred,
      skipped + other.skipped,
    )

object SourceImageObjectReconciliationStats:
  val empty: SourceImageObjectReconciliationStats = SourceImageObjectReconciliationStats(
    recovered = 0,
    markedFailed = 0,
    deleted = 0,
    purgedFailed = 0,
    deferred = 0,
    skipped = 0,
  )

final class SourceImageObjectReconciler[F[_]: Async](
    sourceImages: SourceImagesRepository[F],
    objects: SourceImageObjectStorage[F],
    config: SourceImageObjectReconcilerConfig,
    now: F[Instant],
):
  import SourceImageObjectReconciler.*

  def runOnce: F[SourceImageObjectReconciliationStats] = now.flatMap { timestamp =>
    val staleCutoff = timestamp.minusMillis(config.staleStateAge.toMillis)
    val orphanCutoff = timestamp.minusMillis(config.orphanAge.toMillis)
    val failedPurgeCutoff = timestamp.minusMillis(config.failedRecordRetention.toMillis)
    for
      stateCandidates <- sourceImages.reconciliationCandidates(staleCutoff, config.batchSize)
      stateStats <- stateCandidates.traverse(reconcileState(_, timestamp, failedPurgeCutoff))
      orphanCandidates <- sourceImages.orphanCandidates(orphanCutoff, config.batchSize)
      orphanStats <- orphanCandidates.traverse(deleteOrphan(_, timestamp))
    yield (stateStats ++ orphanStats).foldLeft(SourceImageObjectReconciliationStats.empty)(
      _.combine(_)
    )
  }

  private def reconcileState(
      record: SourceImageRecord,
      timestamp: Instant,
      failedPurgeCutoff: Instant,
  ): F[SourceImageObjectReconciliationStats] = record.status match
    case SourceImageStatus.Reserved => reconcileReserved(record, timestamp)
    case SourceImageStatus.Failed => reconcileFailed(record, timestamp, failedPurgeCutoff)
    case SourceImageStatus.DeletePending => finishDelete(record, timestamp)
    case _ => Async[F].pure(Skipped)

  private def reconcileReserved(
      record: SourceImageRecord,
      timestamp: Instant,
  ): F[SourceImageObjectReconciliationStats] = objects.get(record.objectKey).flatMap {
    case Right(sourceObject) if SourceImageIntegrity.matches(record, sourceObject) =>
      sourceImages.markAvailable(record.id, sourceObject.metadata.etag, timestamp)
        .map(if _ then Recovered else Deferred)
    case Right(_) | Left(SourceImageObjectFailure.IntegrityViolation) =>
      markFailed(record, SourceImageFailureCode.ObjectIntegrityViolation, timestamp)
    case Left(SourceImageObjectFailure.NotFound) =>
      markFailed(record, SourceImageFailureCode.ObjectMissing, timestamp)
    case Left(_) => Async[F].pure(Deferred)
  }

  private def reconcileFailed(
      record: SourceImageRecord,
      timestamp: Instant,
      failedPurgeCutoff: Instant,
  ): F[SourceImageObjectReconciliationStats] = objects.get(record.objectKey).flatMap {
    case Right(sourceObject) if SourceImageIntegrity.matches(record, sourceObject) =>
      recoverFailed(record, sourceObject.metadata.etag, timestamp)
    case Right(_) | Left(SourceImageObjectFailure.IntegrityViolation) =>
      deleteFailedObject(record, failedPurgeCutoff)
    case Left(SourceImageObjectFailure.NotFound) => purgeFailed(record, failedPurgeCutoff)
    case Left(_) => Async[F].pure(Deferred)
  }

  private def recoverFailed(
      record: SourceImageRecord,
      storageEtag: Option[String],
      timestamp: Instant,
  ): F[SourceImageObjectReconciliationStats] = sourceImages.retryFailed(record.id, timestamp)
    .flatMap {
      case false => Async[F].pure(Deferred)
      case true => sourceImages.markAvailable(record.id, storageEtag, timestamp)
          .map(if _ then Recovered else Deferred)
    }

  private def deleteFailedObject(
      record: SourceImageRecord,
      failedPurgeCutoff: Instant,
  ): F[SourceImageObjectReconciliationStats] = objects.delete(record.objectKey).flatMap {
    case Right(_) | Left(SourceImageObjectFailure.NotFound) =>
      purgeFailed(record, failedPurgeCutoff)
    case Left(_) => Async[F].pure(Deferred)
  }

  private def purgeFailed(
      record: SourceImageRecord,
      failedPurgeCutoff: Instant,
  ): F[SourceImageObjectReconciliationStats] =
    if record.updatedAt.isAfter(failedPurgeCutoff) then Async[F].pure(Skipped)
    else sourceImages.purgeFailed(record.id, failedPurgeCutoff)
      .map(if _ then PurgedFailed else Deferred)

  private def markFailed(
      record: SourceImageRecord,
      failureCode: SourceImageFailureCode,
      timestamp: Instant,
  ): F[SourceImageObjectReconciliationStats] = sourceImages
    .markUploadFailed(record.id, failureCode, timestamp).map(if _ then MarkedFailed else Deferred)

  private def deleteOrphan(
      record: SourceImageRecord,
      timestamp: Instant,
  ): F[SourceImageObjectReconciliationStats] = sourceImages
    .beginDeleteUnreferenced(record.id, timestamp).flatMap {
      case SourceImageDeleteResult.Pending(pending) => finishDelete(pending, timestamp)
      case _ => Async[F].pure(Skipped)
    }

  private def finishDelete(
      record: SourceImageRecord,
      timestamp: Instant,
  ): F[SourceImageObjectReconciliationStats] = objects.delete(record.objectKey).flatMap {
    case Right(_) | Left(SourceImageObjectFailure.NotFound) =>
      sourceImages.markDeleted(record.id, timestamp).map(if _ then Deleted else Deferred)
    case Left(_) => Async[F].pure(Deferred)
  }

object SourceImageObjectReconciler:
  private val Recovered = SourceImageObjectReconciliationStats.empty.copy(recovered = 1)
  private val MarkedFailed = SourceImageObjectReconciliationStats.empty.copy(markedFailed = 1)
  private val Deleted = SourceImageObjectReconciliationStats.empty.copy(deleted = 1)
  private val PurgedFailed = SourceImageObjectReconciliationStats.empty.copy(purgedFailed = 1)
  private val Deferred = SourceImageObjectReconciliationStats.empty.copy(deferred = 1)
  private val Skipped = SourceImageObjectReconciliationStats.empty.copy(skipped = 1)
