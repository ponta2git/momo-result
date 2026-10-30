package momo.api.adapters.storage.objectstore

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.effect.std.Mutex
import cats.effect.{Async, Ref}
import cats.syntax.all.*

import momo.api.ports.storage.{SourceImageObjectFailure, SourceImageObjectStorage}
import momo.api.repositories.{
  SourceImageDeleteResult,
  SourceImageFailureCode,
  SourceImageRecord,
  SourceImageScanCursor,
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

final class SourceImageObjectReconciler[F[_]: Async] private (
    sourceImages: SourceImagesRepository[F],
    objects: SourceImageObjectStorage[F],
    config: SourceImageObjectReconcilerConfig,
    now: F[Instant],
    progress: Ref[F, SourceImageObjectReconciler.Progress],
    runMutex: Mutex[F],
):
  import SourceImageObjectReconciler.*

  def runOnce: F[SourceImageObjectReconciliationStats] = runMutex.lock.surround {
    for
      timestamp <- now
      remembered <- progress.get
      staleCutoff = timestamp.minusMillis(config.staleStateAge.toMillis)
      orphanCutoff = timestamp.minusMillis(config.orphanAge.toMillis)
      failedPurgeCutoff = timestamp.minusMillis(config.failedRecordRetention.toMillis)
      statePage <- nextPage(
        remembered.states,
        staleCutoff,
        (cutoff, after) => sourceImages.reconciliationCandidates(cutoff, config.batchSize, after),
      )
      (nextStates, stateCandidates) = statePage
      stateStats <- stateCandidates.traverse(
        reconcileState(_, timestamp, staleCutoff, failedPurgeCutoff)
      )
      _ <- progress.update(_.copy(states = nextStates))
      orphanPage <- nextPage(
        remembered.orphans,
        orphanCutoff,
        (cutoff, after) => sourceImages.orphanCandidates(cutoff, config.batchSize, after),
      )
      (nextOrphans, orphanCandidates) = orphanPage
      orphanStats <- orphanCandidates.traverse(deleteOrphan(_, timestamp))
      _ <- progress.update(_.copy(orphans = nextOrphans))
    yield (stateStats ++ orphanStats).foldLeft(SourceImageObjectReconciliationStats.empty)(
      _.combine(_)
    )
  }

  private def nextPage(
      previous: Option[Sweep],
      freshCutoff: Instant,
      load: (Instant, Option[SourceImageScanCursor]) => F[List[SourceImageRecord]],
  ): F[(Option[Sweep], List[SourceImageRecord])] =
    val cutoff = previous.fold(freshCutoff)(_.cutoff)
    def page(at: Instant, rows: List[SourceImageRecord]) =
      val next = rows.lastOption.map(record =>
        Sweep(at, SourceImageScanCursor(record.updatedAt, record.id))
      )
      (next, rows)
    load(cutoff, previous.map(_.after)).flatMap {
      // Finish the fixed window before admitting newer rows. An empty tail may rewind once,
      // but each run still processes at most one bounded page from each candidate stream.
      case Nil if previous.nonEmpty => load(freshCutoff, None).map(page(freshCutoff, _))
      case rows => page(cutoff, rows).pure[F]
    }

  private def reconcileState(
      record: SourceImageRecord,
      timestamp: Instant,
      staleCutoff: Instant,
      failedPurgeCutoff: Instant,
  ): F[SourceImageObjectReconciliationStats] = record.status match
    case SourceImageStatus.Reserved => reconcileReserved(record, timestamp)
    case SourceImageStatus.Failed =>
      reconcileFailed(record, timestamp, staleCutoff, failedPurgeCutoff)
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
      staleCutoff: Instant,
      failedPurgeCutoff: Instant,
  ): F[SourceImageObjectReconciliationStats] = objects.get(record.objectKey).flatMap {
    case Right(sourceObject) if SourceImageIntegrity.matches(record, sourceObject) =>
      recoverFailed(record, sourceObject.metadata.etag, timestamp)
    case Right(_) | Left(SourceImageObjectFailure.IntegrityViolation) =>
      claimAndDeleteFailed(record, timestamp, staleCutoff, failedPurgeCutoff)
    case Left(SourceImageObjectFailure.NotFound) =>
      claimAndDeleteFailed(record, timestamp, staleCutoff, failedPurgeCutoff)
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

  private def claimAndDeleteFailed(
      record: SourceImageRecord,
      timestamp: Instant,
      staleCutoff: Instant,
      failedPurgeCutoff: Instant,
  ): F[SourceImageObjectReconciliationStats] =
    if record.updatedAt.isAfter(failedPurgeCutoff) then Async[F].pure(Skipped)
    else
      sourceImages.claimFailedPurge(
        record.id,
        failedPurgeCutoff,
        staleCutoff,
        timestamp,
      ).flatMap {
        case None => Async[F].pure(Deferred)
        case Some(claimed) => objects.delete(claimed.objectKey).flatMap {
            case Right(_) | Left(SourceImageObjectFailure.NotFound) =>
              sourceImages.purgeClaimedFailed(claimed.id, timestamp)
                .map(if _ then PurgedFailed else Deferred)
            case Left(_) => Async[F].pure(Deferred)
          }
      }

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
  private final case class Sweep(cutoff: Instant, after: SourceImageScanCursor)
  private final case class Progress(states: Option[Sweep], orphans: Option[Sweep])

  def create[F[_]: Async](
      sourceImages: SourceImagesRepository[F],
      objects: SourceImageObjectStorage[F],
      config: SourceImageObjectReconcilerConfig,
      now: F[Instant],
  ): F[SourceImageObjectReconciler[F]] =
    (Ref.of[F, Progress](Progress(None, None)), Mutex[F]).mapN { (progress, mutex) =>
      new SourceImageObjectReconciler(sourceImages, objects, config, now, progress, mutex)
    }

  private val Recovered = SourceImageObjectReconciliationStats.empty.copy(recovered = 1)
  private val MarkedFailed = SourceImageObjectReconciliationStats.empty.copy(markedFailed = 1)
  private val Deleted = SourceImageObjectReconciliationStats.empty.copy(deleted = 1)
  private val PurgedFailed = SourceImageObjectReconciliationStats.empty.copy(purgedFailed = 1)
  private val Deferred = SourceImageObjectReconciliationStats.empty.copy(deferred = 1)
  private val Skipped = SourceImageObjectReconciliationStats.empty.copy(skipped = 1)
