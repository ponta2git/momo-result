package momo.api.usecases

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.effect.{Concurrent, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.repositories.OcrJobMaintenanceRepository

final class StaleOcrJobReaper[F[_]: Concurrent: LoggerFactory](
    jobs: OcrJobMaintenanceRepository[F],
    staleAfter: FiniteDuration,
    now: F[Instant],
):
  private val logger = LoggerFactory[F].getLogger

  def runOnce: F[Int] =
    for
      instant <- now
      staleBefore = instant.minusMillis(staleAfter.toMillis)
      failed <- jobs.failStaleJobs(instant, staleBefore)
      _ <- logger.info(s"stale_ocr_job_reaper failed=${failed.toString}")
    yield failed

object StaleOcrJobReaper:
  def resource[F[_]: Concurrent: Temporal: LoggerFactory](
      jobs: OcrJobMaintenanceRepository[F],
      staleAfter: FiniteDuration,
      interval: FiniteDuration,
      now: F[Instant],
  ): Resource[F, Unit] =
    val reaper = StaleOcrJobReaper[F](jobs, staleAfter, now)
    PeriodicMaintenance.resource("stale_ocr_job_reaper", interval)(reaper.runOnce.void)
