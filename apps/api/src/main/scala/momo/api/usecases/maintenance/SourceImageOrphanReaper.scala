package momo.api.usecases.maintenance

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.effect.{Concurrent, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.ports.storage.{ImageOrphanCleaner, ReferenceAwareImageOrphanCleaner}
import momo.api.repositories.ImageReferenceRepository

final class SourceImageOrphanReaper[F[_]: Concurrent: LoggerFactory](
    cleaner: ImageOrphanCleaner[F],
):
  private val logger = LoggerFactory[F].getLogger

  def runOnce: F[Int] = cleaner.runOnce.flatTap(deleted =>
    logger.info(s"source_image_orphan_reaper deleted=${deleted.toString}")
  )

object SourceImageOrphanReaper:
  def resource[F[_]: Concurrent: Temporal: LoggerFactory](
      cleaner: ImageOrphanCleaner[F],
      interval: FiniteDuration,
  ): Resource[F, Unit] =
    val reaper = SourceImageOrphanReaper[F](cleaner)
    PeriodicMaintenance.resource("source_image_orphan_reaper", interval)(reaper.runOnce.void)

  /**
   * Adapts the standalone filesystem store by resolving live references at sweep time.
   * DB-backed object storage does not use this adapter because its candidate query owns the
   * reference check atomically.
   */
  def referenceAwareCleaner[F[_]: Concurrent](
      cleaner: ReferenceAwareImageOrphanCleaner[F],
      references: ImageReferenceRepository[F],
      olderThan: FiniteDuration,
      now: F[Instant],
  ): ImageOrphanCleaner[F] = new ImageOrphanCleaner[F]:
    override def runOnce: F[Int] =
      for
        instant <- now
        threshold = instant.minusMillis(olderThan.toMillis)
        referenced <- references.referencedImageIds
        deleted <- cleaner.deleteOrphans(referenced, threshold)
      yield deleted
