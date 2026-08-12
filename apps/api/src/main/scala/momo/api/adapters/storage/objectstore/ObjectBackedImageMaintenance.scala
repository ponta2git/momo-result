package momo.api.adapters.storage.objectstore

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{
  ImageDiskUsage,
  ImageOrphanCleaner,
  ImageStorageInspector,
  ImageStorageUsage
}
import momo.api.repositories.SourceImagesRepository

final class ObjectBackedImageMaintenance[F[_]: Async: LoggerFactory](
    sourceImages: SourceImagesRepository[F],
    reconciler: SourceImageObjectReconciler[F],
) extends ImageStorageInspector[F], ImageOrphanCleaner[F]:
  private val logger = LoggerFactory[F].getLogger

  override def unreferencedUsage(
      ownerAccountId: AccountId,
      referenced: Set[ImageId],
  ): F[ImageStorageUsage] =
    val _ = referenced
    sourceImages.unreferencedUsage(ownerAccountId)

  override def diskUsage: F[Option[ImageDiskUsage]] = Async[F].pure(None)

  override def deleteOrphans(referenced: Set[ImageId], olderThan: Instant): F[Int] =
    val _ = (referenced, olderThan)
    reconciler.runOnce.flatTap(stats => logger.info(
      s"source_image_object_reconciliation recovered=${stats.recovered.toString} " +
        s"markedFailed=${stats.markedFailed.toString} deleted=${stats.deleted.toString} " +
        s"purgedFailed=${stats.purgedFailed.toString} deferred=${stats.deferred.toString} " +
        s"skipped=${stats.skipped.toString}"
    )).map(_.deleted)
