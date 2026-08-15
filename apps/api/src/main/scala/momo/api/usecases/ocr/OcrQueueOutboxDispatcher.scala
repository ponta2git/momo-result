package momo.api.usecases.ocr

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{Clock, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.logging.SafeLog
import momo.api.ports.queue.OcrJobQueuePublisher
import momo.api.repositories.{OcrQueueOutboxRecord, OcrQueueOutboxRepository}
import momo.api.usecases.queue.{
  OutboxDrainResult,
  OutboxKind,
  OutboxWakeCoordinator,
  OutboxWakeCoordinatorConfig,
  OutboxWakeDriver,
  OutboxWakeup
}

final case class OcrQueueOutboxDispatcherConfig(
    batchSize: Int = 10,
    claimTtl: FiniteDuration = 30.seconds,
    maxBackoff: FiniteDuration = 60.seconds,
    redeliveryAfter: FiniteDuration = 120.seconds,
    coldRecoveryInterval: FiniteDuration = 300.seconds,
    maxConsecutiveBatches: Int = 100,
):
  require((1 to 100).contains(batchSize), "OCR dispatcher batchSize must be between 1 and 100")
  require(claimTtl > Duration.Zero, "OCR dispatcher claimTtl must be positive")
  require(maxBackoff >= 1.second, "OCR dispatcher maxBackoff must be at least one second")
  require(redeliveryAfter > Duration.Zero, "OCR dispatcher redeliveryAfter must be positive")
  require(
    coldRecoveryInterval > Duration.Zero,
    "OCR dispatcher coldRecoveryInterval must be positive"
  )
  require(
    (1 to 100).contains(maxConsecutiveBatches),
    "OCR dispatcher maxConsecutiveBatches must be between 1 and 100",
  )

final class OcrQueueOutboxDispatcher[F[_]: Temporal: Clock: LoggerFactory](
    outbox: OcrQueueOutboxRepository[F],
    queue: OcrJobQueuePublisher[F],
    config: OcrQueueOutboxDispatcherConfig,
) extends OutboxWakeDriver[F]:
  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[OcrQueueOutboxDispatcher[F]])
  private val publisher = OcrQueueOutboxPublisher[F](outbox, queue, config.maxBackoff)

  override def drainBatch: F[OutboxDrainResult] =
    for
      now <- Clock[F].realTimeInstant
      redeliverBefore = plus(now, -config.redeliveryAfter)
      rearmed <- outbox.rearmQueuedForRedelivery(now, redeliverBefore, config.batchSize)
      _ <- Option.when(rearmed > 0)(
        logger.info(s"OCR queue semantic redelivery rearmedRows=${rearmed.toString}")
      ).sequence_
      rows <- outbox.claimDue(config.batchSize, now, plus(now, config.claimTtl))
      _ <- rows.traverse_(publisher.publish)
      result <-
        if rearmed > 0 || rows.nonEmpty then OutboxDrainResult.Progress.pure[F]
        else
          outbox.nextWakeAt(now, config.redeliveryAfter)
            .map(nextWakeAt => OutboxDrainResult.Idle(afterContention(now, nextWakeAt)))
    yield result

  private def afterContention(now: Instant, nextWakeAt: Option[Instant]): Option[Instant] =
    nextWakeAt.map(deadline => if deadline.isAfter(now) then deadline else plus(now, 1.second))

  private def plus(instant: Instant, duration: FiniteDuration): Instant = instant
    .plusMillis(duration.toMillis)

object OcrQueueOutboxDispatcher:
  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: OcrQueueOutboxRepository[F],
      queue: OcrJobQueuePublisher[F],
      config: OcrQueueOutboxDispatcherConfig,
  ): Resource[F, Unit] = OutboxWakeup.resource[F].flatMap(wakeup =>
    resource(outbox, queue, config, wakeup)
  )

  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: OcrQueueOutboxRepository[F],
      queue: OcrJobQueuePublisher[F],
      config: OcrQueueOutboxDispatcherConfig,
      wakeup: OutboxWakeup[F],
  ): Resource[F, Unit] = OutboxWakeCoordinator.resource(
    OutboxKind.Ocr,
    wakeup,
    new OcrQueueOutboxDispatcher(outbox, queue, config),
    OutboxWakeCoordinatorConfig(
      coldRecoveryInterval = Some(config.coldRecoveryInterval),
      maxConsecutiveBatches = config.maxConsecutiveBatches,
    ),
  )

final class OcrQueueOutboxPublisher[F[_]: Temporal: Clock: LoggerFactory](
    outbox: OcrQueueOutboxRepository[F],
    queue: OcrJobQueuePublisher[F],
    maxBackoff: FiniteDuration,
):
  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[OcrQueueOutboxPublisher[F]])

  def publish(row: OcrQueueOutboxRecord): F[Unit] = queue.publish(row.enqueueRequest).attempt
    .flatMap {
      case Right(redisMessageId) => Clock[F].realTimeInstant.flatMap { now =>
          outbox.markDelivered(row.id, row.claimToken, redisMessageId, now).flatMap {
            case true => Temporal[F].unit
            case false => logger.warn(
                s"OCR queue outbox delivered update ignored for stale claim outboxId=${row.id} " +
                  s"jobId=${row.jobId.value}"
              )
          }
        }
      case Left(error) =>
        for
          now <- Clock[F].realTimeInstant
          nextAttemptAt = plus(now, nextBackoff(row.attemptCount + 1))
          sanitized = sanitizeError(error)
          errorClasses = SafeLog.throwableClasses(error)
          _ <- logger.error(
            s"OCR queue outbox publish failed outboxId=${row.id} jobId=${row.jobId.value} " +
              s"attempt=${row.attemptCount + 1} nextAttemptAt=$nextAttemptAt " +
              s"errorClasses=$errorClasses"
          )
          released <- outbox
            .releaseForRetry(row.id, row.claimToken, sanitized, nextAttemptAt, now)
          _ <-
            if released then Temporal[F].unit
            else
              logger.warn(
                s"OCR queue outbox retry release ignored for stale claim outboxId=${row.id} " +
                  s"jobId=${row.jobId.value}"
              )
        yield ()
    }

  private def nextBackoff(attempt: Int): FiniteDuration =
    val exponent = math.max(0, math.min(attempt - 1, 6))
    math.min(maxBackoff.toSeconds, 1L << exponent).seconds

  private def plus(instant: Instant, duration: FiniteDuration): Instant = instant
    .plusMillis(duration.toMillis)

  private def sanitizeError(error: Throwable): String = error.getClass.getName
