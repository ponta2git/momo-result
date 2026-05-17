package momo.api.usecases

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.syntax.all.*
import cats.effect.{Clock, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.logging.SafeLog
import momo.api.repositories.{OcrQueueOutboxRecord, OcrQueueOutboxRepository, QueueProducer}

final case class OcrQueueOutboxDispatcherConfig(
    batchSize: Int = 10,
    pollInterval: FiniteDuration = 1.second,
    claimTtl: FiniteDuration = 30.seconds,
    maxBackoff: FiniteDuration = 60.seconds,
)

final class OcrQueueOutboxDispatcher[F[_]: Temporal: Clock: LoggerFactory](
    outbox: OcrQueueOutboxRepository[F],
    queue: QueueProducer[F],
    config: OcrQueueOutboxDispatcherConfig,
):
  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[OcrQueueOutboxDispatcher[F]])

  def run: F[Unit] =
    (runOnce.handleErrorWith { error =>
      val classes = SafeLog.throwableClasses(error)
      logger.error(s"OCR queue outbox dispatcher tick failed errorClasses=$classes")
    } >> Temporal[F].sleep(config.pollInterval)).foreverM

  def runOnce: F[Unit] =
    for
      now <- Clock[F].realTimeInstant
      rows <- outbox
        .claimDue(limit = config.batchSize, now = now, claimUntil = plus(now, config.claimTtl))
      _ <- rows.traverse_(publishOne)
    yield ()

  private def publishOne(row: OcrQueueOutboxRecord): F[Unit] = queue.publish(row.payload).attempt
    .flatMap {
      case Right(redisMessageId) => Clock[F].realTimeInstant.flatMap { now =>
          outbox.markDelivered(row.id, row.claimExpiresAt, redisMessageId, now).flatMap {
            case true => Temporal[F].unit
            case false => logger
                .warn(s"OCR queue outbox delivered update ignored for stale claim outboxId=${row
                    .id} " + s"jobId=${row.jobId.value}")
          }
        }
      case Left(error) =>
        for
          now <- Clock[F].realTimeInstant
          nextAttemptAt = plus(now, nextBackoff(row.attemptCount + 1))
          sanitized = sanitizeError(error)
          errorClasses = SafeLog.throwableClasses(error)
          _ <- logger.error(s"OCR queue outbox publish failed outboxId=${row.id} jobId=${row.jobId
              .value} attempt=${row.attemptCount +
              1} nextAttemptAt=$nextAttemptAt errorClasses=$errorClasses")
          released <- outbox
            .releaseForRetry(row.id, row.claimExpiresAt, sanitized, nextAttemptAt, now)
          _ <-
            if released then Temporal[F].unit
            else
              logger.warn(s"OCR queue outbox retry release ignored for stale claim outboxId=${row
                  .id} " + s"jobId=${row.jobId.value}")
        yield ()
    }

  private def nextBackoff(attempt: Int): FiniteDuration =
    val seconds = math.min(config.maxBackoff.toSeconds, math.max(1L, 1L << math.min(attempt, 6)))
    seconds.seconds

  private def plus(instant: Instant, duration: FiniteDuration): Instant = instant
    .plusMillis(duration.toMillis)

  private def sanitizeError(error: Throwable): String = error.getClass.getName

object OcrQueueOutboxDispatcher:
  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: OcrQueueOutboxRepository[F],
      queue: QueueProducer[F],
  ): Resource[F, Unit] = resource(outbox, queue, OcrQueueOutboxDispatcherConfig())

  def resource[F[_]: Temporal: Clock: LoggerFactory](
      outbox: OcrQueueOutboxRepository[F],
      queue: QueueProducer[F],
      config: OcrQueueOutboxDispatcherConfig,
  ): Resource[F, Unit] = Resource
    .make(new OcrQueueOutboxDispatcher(outbox, queue, config).run.start)(_.cancel).void
