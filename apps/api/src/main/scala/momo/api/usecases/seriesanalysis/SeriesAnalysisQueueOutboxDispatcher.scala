package momo.api.usecases.seriesanalysis

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Clock, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.logging.SafeLog
import momo.api.ports.queue.SeriesAnalysisQueuePublisher
import momo.api.repositories.{SeriesAnalysisQueueOutboxRecord, SeriesAnalysisQueueOutboxRepository}
import momo.api.usecases.queue.{
  OutboxDrainResult,
  OutboxKind,
  OutboxWakeCoordinator,
  OutboxWakeCoordinatorConfig,
  OutboxWakeDriver,
  OutboxWakeup
}

final case class SeriesAnalysisQueueDispatcherConfig(
    batchSize: Int = 10,
    claimTtl: FiniteDuration = 30.seconds,
    maxBackoff: FiniteDuration = 60.seconds,
    redeliveryAfter: FiniteDuration = 5.minutes,
    coldRecoveryInterval: FiniteDuration = 30.minutes,
    maxConsecutiveBatches: Int = 100,
):
  require((1 to 100).contains(batchSize), "analysis dispatcher batchSize must be between 1 and 100")
  require(claimTtl > Duration.Zero, "analysis dispatcher claimTtl must be positive")
  require(maxBackoff >= 1.second, "analysis dispatcher maxBackoff must be at least one second")
  require(redeliveryAfter > Duration.Zero, "analysis dispatcher redeliveryAfter must be positive")
  require(
    coldRecoveryInterval > Duration.Zero,
    "analysis dispatcher coldRecoveryInterval must be positive",
  )
  require(
    (1 to 100).contains(maxConsecutiveBatches),
    "analysis dispatcher maxConsecutiveBatches must be between 1 and 100",
  )

private[seriesanalysis] final class SeriesAnalysisQueueOutboxDispatcher[
    F[_]: Temporal: Clock: LoggerFactory
](
    outbox: SeriesAnalysisQueueOutboxRepository[F],
    queue: SeriesAnalysisQueuePublisher[F],
    config: SeriesAnalysisQueueDispatcherConfig,
) extends OutboxWakeDriver[F]:
  private val logger = LoggerFactory[F].getLoggerFromClass(
    classOf[SeriesAnalysisQueueOutboxDispatcher[F]]
  )

  override def drainBatch: F[OutboxDrainResult] =
    for
      now <- Clock[F].realTimeInstant
      claimUntil = plus(now, config.claimTtl)
      redeliverBefore = plus(now, -config.redeliveryAfter)
      expanded <- outbox.expandPendingCampaignTargets(now, config.batchSize)
      reconciled <- outbox.reconcileQueued(now, redeliverBefore, config.batchSize)
      _ <- Option.when(expanded > 0 || reconciled > 0)(
        logger.info(
          s"Analysis queue maintenance expandedTargets=${expanded.toString} " +
            s"reconciledJobs=${reconciled.toString}"
        )
      ).sequence_
      rows <- outbox.claimDue(config.batchSize, now, claimUntil)
      _ <- rows.traverse_(publish)
      result <-
        if expanded > 0 || reconciled > 0 || rows.nonEmpty then OutboxDrainResult.Progress.pure[F]
        else
          outbox.nextWakeAt(now, config.redeliveryAfter)
            .map(nextWakeAt => OutboxDrainResult.Idle(afterContention(now, nextWakeAt)))
    yield result

  private def afterContention(now: Instant, nextWakeAt: Option[Instant]): Option[Instant] =
    nextWakeAt.map(deadline => if deadline.isAfter(now) then deadline else plus(now, 1.second))

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
              s"Analysis queue publish failed outboxId=${row.id} " +
                s"attempt=${row.attemptCount + 1} " +
                s"errorClasses=${SafeLog.throwableClasses(error)}"
            )
          else logger.warn(s"Analysis outbox retry ignored for stale claim outboxId=${row.id}")
        yield ()
    }

  private def nextBackoff(attempt: Int): FiniteDuration =
    val exponent = math.max(0, math.min(attempt - 1, 6))
    math.min(config.maxBackoff.toSeconds, 1L << exponent).seconds

  private def plus(instant: Instant, duration: FiniteDuration): Instant = instant
    .plusMillis(duration.toMillis)

object SeriesAnalysisQueueOutboxDispatcher:
  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: SeriesAnalysisQueueOutboxRepository[F],
      queue: SeriesAnalysisQueuePublisher[F],
      config: SeriesAnalysisQueueDispatcherConfig,
  ): Resource[F, Unit] = OutboxWakeup.resource[F].flatMap(wakeup =>
    resource(outbox, queue, config, wakeup)
  )

  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: SeriesAnalysisQueueOutboxRepository[F],
      queue: SeriesAnalysisQueuePublisher[F],
      config: SeriesAnalysisQueueDispatcherConfig,
      wakeup: OutboxWakeup[F],
  ): Resource[F, Unit] = resource(outbox, queue, config, wakeup, _ => Temporal[F].unit)

  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: SeriesAnalysisQueueOutboxRepository[F],
      queue: SeriesAnalysisQueuePublisher[F],
      config: SeriesAnalysisQueueDispatcherConfig,
      wakeup: OutboxWakeup[F],
      onUnexpectedExit: Throwable => F[Unit],
  ): Resource[F, Unit] = OutboxWakeCoordinator.resource(
    OutboxKind.SeriesAnalysis,
    wakeup,
    new SeriesAnalysisQueueOutboxDispatcher(outbox, queue, config),
    OutboxWakeCoordinatorConfig(
      coldRecoveryInterval = Some(config.coldRecoveryInterval),
      maxConsecutiveBatches = config.maxConsecutiveBatches,
    ),
    onUnexpectedExit,
  )
