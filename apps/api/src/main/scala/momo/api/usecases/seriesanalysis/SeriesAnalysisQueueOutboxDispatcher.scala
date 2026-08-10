package momo.api.usecases.seriesanalysis

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.syntax.all.*
import cats.effect.{Clock, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.logging.SafeLog
import momo.api.ports.queue.SeriesAnalysisQueuePublisher
import momo.api.repositories.{SeriesAnalysisQueueOutboxRecord, SeriesAnalysisQueueOutboxRepository}

final case class SeriesAnalysisQueueDispatcherConfig(
    batchSize: Int = 10,
    pollInterval: FiniteDuration = 30.seconds,
    claimTtl: FiniteDuration = 30.seconds,
    maxBackoff: FiniteDuration = 60.seconds,
    redeliveryAfter: FiniteDuration = 5.minutes,
):
  require((1 to 100).contains(batchSize), "analysis dispatcher batchSize must be between 1 and 100")
  require(pollInterval > Duration.Zero, "analysis dispatcher pollInterval must be positive")
  require(claimTtl > Duration.Zero, "analysis dispatcher claimTtl must be positive")
  require(maxBackoff > Duration.Zero, "analysis dispatcher maxBackoff must be positive")
  require(redeliveryAfter > Duration.Zero, "analysis dispatcher redeliveryAfter must be positive")

private[seriesanalysis] final class SeriesAnalysisQueueOutboxDispatcher[
    F[_]: Temporal: Clock: LoggerFactory
](
    outbox: SeriesAnalysisQueueOutboxRepository[F],
    queue: SeriesAnalysisQueuePublisher[F],
    config: SeriesAnalysisQueueDispatcherConfig,
):
  private val logger = LoggerFactory[F].getLoggerFromClass(
    classOf[SeriesAnalysisQueueOutboxDispatcher[F]]
  )

  def run: F[Unit] =
    (runOnce.handleErrorWith(error =>
      logger.error(s"Analysis queue dispatcher tick failed errorClasses=${SafeLog
          .throwableClasses(error)}")
    ) >> Temporal[F].sleep(config.pollInterval)).foreverM

  def runOnce: F[Unit] =
    for
      now <- Clock[F].realTimeInstant
      claimUntil = plus(now, config.claimTtl)
      redeliverBefore = plus(now, -config.redeliveryAfter)
      expanded <- outbox.expandPendingCampaignTargets(now, config.batchSize)
      reconciled <- outbox.reconcileQueued(now, redeliverBefore, config.batchSize)
      _ <- Option.when(expanded > 0 || reconciled > 0)(
        logger.info(
          s"Analysis queue maintenance expandedTargets=${expanded.toString} reconciledJobs=${reconciled.toString}"
        )
      ).sequence_
      rows <- outbox.claimDue(config.batchSize, now, claimUntil)
      _ <- rows.traverse_(publish)
    yield ()

  private def publish(row: SeriesAnalysisQueueOutboxRecord): F[Unit] = queue.publish(row.jobId)
    .attempt.flatMap {
      case Right(messageId) => Clock[F].realTimeInstant.flatMap(now =>
          outbox.markDelivered(row.id, row.claimExpiresAt, messageId, now).flatMap {
            case true => Temporal[F].unit
            case false => logger.warn(
                s"Analysis outbox delivered update ignored for stale claim outboxId=${row.id}"
              )
          }
        )
      case Left(error) =>
        for
          now <- Clock[F].realTimeInstant
          nextAttempt = plus(now, nextBackoff(row.attemptCount + 1))
          released <- outbox.releaseForRetry(
            row.id,
            row.claimExpiresAt,
            nextAttempt,
            error.getClass.getName,
            now,
          )
          _ <- if released then
            logger.warn(
              s"Analysis queue publish failed outboxId=${row.id} attempt=${row.attemptCount + 1} errorClasses=${SafeLog
                  .throwableClasses(error)}"
            )
          else
            logger.warn(
              s"Analysis outbox retry ignored for stale claim outboxId=${row.id}"
            )
        yield ()
    }

  private def nextBackoff(attempt: Int): FiniteDuration = math
    .min(config.maxBackoff.toSeconds, math.max(1L, 1L << math.min(attempt, 6))).seconds

  private def plus(instant: Instant, duration: FiniteDuration): Instant = instant
    .plusMillis(duration.toMillis)

object SeriesAnalysisQueueOutboxDispatcher:
  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: SeriesAnalysisQueueOutboxRepository[F],
      queue: SeriesAnalysisQueuePublisher[F],
      config: SeriesAnalysisQueueDispatcherConfig,
  ): Resource[F, Unit] = Resource
    .make(new SeriesAnalysisQueueOutboxDispatcher(outbox, queue, config).run.start)(_.cancel).void
