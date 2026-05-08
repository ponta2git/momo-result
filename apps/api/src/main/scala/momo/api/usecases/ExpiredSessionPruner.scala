package momo.api.usecases

import java.time.Instant

import scala.concurrent.duration.FiniteDuration

import cats.effect.{Concurrent, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.repositories.AppSessionsRepository

final class ExpiredSessionPruner[F[_]: Concurrent: LoggerFactory](
    sessions: AppSessionsRepository[F],
    now: F[Instant],
):
  private val logger = LoggerFactory[F].getLogger

  def runOnce: F[Int] =
    for
      instant <- now
      deleted <- sessions.deleteExpired(instant)
      _ <- logger.info(s"expired_session_pruner deleted=${deleted.toString}")
    yield deleted

object ExpiredSessionPruner:
  def resource[F[_]: Concurrent: Temporal: LoggerFactory](
      sessions: AppSessionsRepository[F],
      interval: FiniteDuration,
      now: F[Instant],
  ): Resource[F, Unit] =
    val pruner = ExpiredSessionPruner[F](sessions, now)
    PeriodicMaintenance.resource("expired_session_pruner", interval)(pruner.runOnce.void)
