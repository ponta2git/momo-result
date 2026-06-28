package momo.api.bootstrap

import cats.effect.{Async, Resource}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.config.AppConfig
import momo.api.repositories.{
  AppSessionsRepository,
  IdempotencyRepository,
  ImageOrphanStore,
  ImageReferenceRepository,
  OcrJobMaintenanceRepository
}
import momo.api.usecases.{
  ExpiredSessionPruner,
  PeriodicMaintenance,
  SourceImageOrphanReaper,
  StaleOcrJobReaper
}

private[bootstrap] object RuntimeMaintenance:
  def resource[F[_]: Async: LoggerFactory](
      config: AppConfig,
      imageStore: ImageOrphanStore[F],
      imageReferences: ImageReferenceRepository[F],
      ocrMaintenance: OcrJobMaintenanceRepository[F],
      appSessions: AppSessionsRepository[F],
      idempotency: IdempotencyRepository[F],
      now: F[java.time.Instant],
  ): Resource[F, Unit] =
    val logger = LoggerFactory[F].getLogger
    SourceImageOrphanReaper.resource[F](
      imageStore = imageStore,
      references = imageReferences,
      olderThan = config.resourceLimits.imageOrphanOlderThan,
      interval = config.resourceLimits.imageOrphanReaperInterval,
      now = now,
    ).flatMap(_ =>
      StaleOcrJobReaper.resource[F](
        jobs = ocrMaintenance,
        staleAfter = config.resourceLimits.staleOcrJobAfter,
        interval = config.resourceLimits.staleOcrJobReaperInterval,
        now = now,
      )
    ).flatMap(_ =>
      ExpiredSessionPruner.resource[F](
        sessions = appSessions,
        interval = config.resourceLimits.sessionPruneInterval,
        now = now,
      )
    ).flatMap(_ =>
      PeriodicMaintenance
        .resource("idempotency_key_pruner", config.resourceLimits.sessionPruneInterval)(
          now.flatMap(idempotency.cleanup)
            .flatMap(deleted => logger.info(s"idempotency_key_pruner deleted=${deleted.toString}"))
        )
    )
