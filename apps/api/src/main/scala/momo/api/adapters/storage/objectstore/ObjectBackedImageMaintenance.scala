package momo.api.adapters.storage.objectstore

import cats.effect.Async
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.ports.storage.{ImageDiskUsage, ImageOrphanCleaner, ImageStorageCapacityInspector}
final class ObjectBackedImageMaintenance[F[_]: Async: LoggerFactory](
    reconciler: SourceImageObjectReconciler[F],
    diskUsageProbe: F[Option[ImageDiskUsage]],
) extends ImageStorageCapacityInspector[F], ImageOrphanCleaner[F]:
  private val logger = LoggerFactory[F].getLogger

  override def diskUsage: F[Option[ImageDiskUsage]] = diskUsageProbe

  override def runOnce: F[Int] = reconciler.runOnce.flatTap(stats =>
    logger.info(
      s"source_image_object_reconciliation recovered=${stats.recovered.toString} " +
        s"markedFailed=${stats.markedFailed.toString} deleted=${stats.deleted.toString} " +
        s"purgedFailed=${stats.purgedFailed.toString} deferred=${stats.deferred.toString} " +
        s"skipped=${stats.skipped.toString}"
    )
  ).map(_.deleted)
