package momo.api.usecases

import scala.concurrent.duration.FiniteDuration

import cats.effect.{Concurrent, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

object PeriodicMaintenance:
  def resource[F[_]: Concurrent: Temporal: LoggerFactory](name: String, interval: FiniteDuration)(
      runOnce: F[Unit]
  ): Resource[F, Unit] =
    val logger = LoggerFactory[F].getLogger
    def logged: F[Unit] = runOnce.handleErrorWith(error => logger.error(error)(s"$name failed"))
    def loop: F[Unit] = logged >> Temporal[F].sleep(interval) >> loop
    Resource.make(Concurrent[F].start(loop))(_.cancel).void
