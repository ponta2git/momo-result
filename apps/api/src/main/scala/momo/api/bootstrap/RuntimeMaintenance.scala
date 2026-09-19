package momo.api.bootstrap

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.config.AppConfig
import momo.api.ports.storage.ImageOrphanCleaner
import momo.api.repositories.{
  AppSessionsRepository,
  IdempotencyRepository,
  OcrJobMaintenanceRepository
}
import momo.api.usecases.maintenance.{
  ExpiredSessionPruner,
  PeriodicMaintenance,
  SourceImageOrphanReaper
}
import momo.api.usecases.ocr.StaleOcrJobReaper

private[bootstrap] object RuntimeMaintenance:
  def resource[F[_]: Async: LoggerFactory](
      config: AppConfig,
      imageOrphanCleaner: ImageOrphanCleaner[F],
      ocrMaintenance: OcrJobMaintenanceRepository[F],
      appSessions: AppSessionsRepository[F],
      idempotency: IdempotencyRepository[F],
      now: F[java.time.Instant],
  ): Resource[F, Unit] =
    val logger = LoggerFactory[F].getLogger
    val imageOrphanReaper = SourceImageOrphanReaper.resource[F](
      cleaner = imageOrphanCleaner,
      interval = config.resourceLimits.imageOrphanReaperInterval,
    )
    val staleOcrJobReaper = StaleOcrJobReaper.resource[F](
      jobs = ocrMaintenance,
      staleAfter = config.resourceLimits.staleOcrJobAfter,
      interval = config.resourceLimits.staleOcrJobReaperInterval,
      now = now,
    )
    val expiredSessionPruner = ExpiredSessionPruner.resource[F](
      sessions = appSessions,
      interval = config.resourceLimits.sessionPruneInterval,
      now = now,
    )
    val idempotencyKeyPruner = PeriodicMaintenance.resource(
      "idempotency_key_pruner",
      config.resourceLimits.sessionPruneInterval,
    )(
      now.flatMap(idempotency.cleanup)
        .flatMap(deleted => logger.info(s"idempotency_key_pruner deleted=${deleted.toString}"))
    )
    imageOrphanReaper *> staleOcrJobReaper *> expiredSessionPruner *> idempotencyKeyPruner
