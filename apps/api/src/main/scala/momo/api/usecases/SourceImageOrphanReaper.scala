package momo.api.usecases

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.effect.{Concurrent, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.adapters.LocalFsImageStore
import momo.api.repositories.ImageReferenceRepository

final class SourceImageOrphanReaper[F[_]: Concurrent: LoggerFactory](
    imageStore: LocalFsImageStore[F],
    references: ImageReferenceRepository[F],
    olderThan: FiniteDuration,
    now: F[Instant],
):
  private val logger = LoggerFactory[F].getLogger

  def runOnce: F[Int] =
    for
      instant <- now
      threshold = instant.minusMillis(olderThan.toMillis)
      referenced <- references.referencedImageIds
      deleted <- imageStore.deleteOrphans(referenced, threshold)
      _ <- logger.info(s"source_image_orphan_reaper deleted=${deleted.toString}")
    yield deleted

object SourceImageOrphanReaper:
  def resource[F[_]: Concurrent: Temporal: LoggerFactory](
      imageStore: LocalFsImageStore[F],
      references: ImageReferenceRepository[F],
      olderThan: FiniteDuration,
      interval: FiniteDuration,
      now: F[Instant],
  ): Resource[F, Unit] =
    val reaper = SourceImageOrphanReaper[F](imageStore, references, olderThan, now)
    PeriodicMaintenance.resource("source_image_orphan_reaper", interval)(reaper.runOnce.void)
