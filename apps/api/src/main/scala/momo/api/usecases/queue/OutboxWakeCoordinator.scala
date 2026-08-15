package momo.api.usecases.queue

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.syntax.all.*
import cats.effect.{Clock, Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

enum OutboxDrainResult derives CanEqual:
  /** The one-shot driver made progress; another bounded batch may be useful immediately. */
  case Progress

  /** Due work is empty. The optional value is the earliest known retry or semantic deadline. */
  case Idle(nextWakeAt: Option[Instant])

trait OutboxWakeDriver[F[_]]:
  /** Runs at most one bounded, outbox-specific maintenance/claim/publish batch. */
  def drainBatch: F[OutboxDrainResult]

final case class OutboxWakeCoordinatorConfig(
    coldRecoveryInterval: Option[FiniteDuration],
    maxConsecutiveBatches: Int = 100,
):
  require(
    coldRecoveryInterval.forall(_ > Duration.Zero),
    "outbox coldRecoveryInterval must be positive",
  )
  require(
    (1 to 100).contains(maxConsecutiveBatches),
    "outbox maxConsecutiveBatches must be between 1 and 100",
  )

final class OutboxWakeCoordinator[F[_]: Temporal: Clock: LoggerFactory](
    kind: OutboxKind,
    wakeup: OutboxWakeup[F],
    driver: OutboxWakeDriver[F],
    config: OutboxWakeCoordinatorConfig,
):
  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[OutboxWakeCoordinator[F]])

  def run: F[Unit] = loop(consecutiveFailures = 0)

  private def loop(consecutiveFailures: Int): F[Unit] = drainToIdle.attempt.flatMap {
    case Right(nextWakeAt) => awaitNext(nextWakeAt) >> loop(consecutiveFailures = 0)
    case Left(error) =>
      val retryAfter = retryBackoff(consecutiveFailures)
      logger.error(
        s"Outbox coordinator drain failed kind=$kind retryAfter=$retryAfter " +
          s"errorClass=${error.getClass.getName}"
      ) >> Temporal[F].sleep(retryAfter) >> wakeup.tryAwait(kind).void >>
        loop(consecutiveFailures + 1)
  }

  private[queue] def drainToIdle: F[Option[Instant]] =
    def go(completedBatches: Int): F[Option[Instant]] = driver.drainBatch.flatMap {
      case OutboxDrainResult.Idle(nextWakeAt) => nextWakeAt.pure[F]
      case OutboxDrainResult.Progress if completedBatches + 1 >= config.maxConsecutiveBatches =>
        wakeup.submit(PostCommitEffects.wake(kind)).void.as(None)
      case OutboxDrainResult.Progress => go(completedBatches + 1)
    }

    go(completedBatches = 0)

  private def awaitNext(nextWakeAt: Option[Instant]): F[Unit] =
    for
      now <- Clock[F].realTimeInstant
      coldWakeAt = config.coldRecoveryInterval.map(interval => plus(now, interval))
      deadline = List(nextWakeAt, coldWakeAt).flatten.minOption
      _ <- deadline match
        case Some(value) => Temporal[F].race(wakeup.await(kind), sleepUntil(now, value)).void
        case None => wakeup.await(kind)
    yield ()

  private def sleepUntil(now: Instant, deadline: Instant): F[Unit] =
    val delayMillis = java.time.Duration.between(now, deadline).toMillis
    Temporal[F].sleep(math.max(0L, delayMillis).millis)

  private def retryBackoff(consecutiveFailures: Int): FiniteDuration =
    OutboxWakeCoordinator.RetryBackoffs(
      math.min(consecutiveFailures, OutboxWakeCoordinator.RetryBackoffs.size - 1)
    )

  private def plus(instant: Instant, duration: FiniteDuration): Instant = instant
    .plusMillis(duration.toMillis)

object OutboxWakeCoordinator:
  private val RetryBackoffs = Vector(1, 2, 4, 8, 16, 32, 60).map(_.seconds)

  def resource[F[_]: Temporal: Clock: LoggerFactory](
      kind: OutboxKind,
      wakeup: OutboxWakeup[F],
      driver: OutboxWakeDriver[F],
      config: OutboxWakeCoordinatorConfig,
  ): Resource[F, Unit] = Resource
    .make(new OutboxWakeCoordinator(kind, wakeup, driver, config).run.start)(_.cancel)
    .void
