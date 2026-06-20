package momo.api.usecases

import java.time.{Duration as JavaDuration, Instant}

import scala.concurrent.duration.*

import cats.effect.Clock
import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.{OcrQueueBacklogSnapshot, OcrQueueOutboxRepository, QueueHealthProbe}

trait OcrAdmissionGuard[F[_]]:
  def ensureAvailable: F[Either[AppError, Unit]]
  def healthStatus: F[String]

object OcrAdmissionGuard:
  final case class Config(
      dueBacklogLimit: Int,
      activeBacklogLimit: Int,
      oldestDueMaxDelay: FiniteDuration,
      deadLetterBacklogLimit: Int,
  )

  enum Decision derives CanEqual:
    case Allowed
    case Rejected(reason: Rejection)

  enum Rejection derives CanEqual:
    case RedisUnavailable(errorClasses: String)
    case OutboxStatusUnavailable(errorClasses: String)
    case DeadLetterStatusUnavailable(errorClasses: String)
    case DueBacklogExceeded(count: Long, limit: Int)
    case ActiveBacklogExceeded(count: Long, limit: Int)
    case OldestDueDelayed(delaySeconds: Long, limitSeconds: Long)
    case DeadLetterBacklogExceeded(length: Long, limit: Int)

    def reason: String = this match
      case RedisUnavailable(_) => "redis_unavailable"
      case OutboxStatusUnavailable(_) => "outbox_status_unavailable"
      case DeadLetterStatusUnavailable(_) => "dead_letter_status_unavailable"
      case DueBacklogExceeded(_, _) => "outbox_due_backlog_exceeded"
      case ActiveBacklogExceeded(_, _) => "outbox_active_backlog_exceeded"
      case OldestDueDelayed(_, _) => "outbox_oldest_due_delayed"
      case DeadLetterBacklogExceeded(_, _) => "dead_letter_backlog_exceeded"

    def logFields: String = this match
      case RedisUnavailable(errorClasses) => s"reason=$reason errorClasses=$errorClasses"
      case OutboxStatusUnavailable(errorClasses) => s"reason=$reason errorClasses=$errorClasses"
      case DeadLetterStatusUnavailable(errorClasses) => s"reason=$reason errorClasses=$errorClasses"
      case DueBacklogExceeded(count, limit) => s"reason=$reason count=$count limit=$limit"
      case ActiveBacklogExceeded(count, limit) => s"reason=$reason count=$count limit=$limit"
      case OldestDueDelayed(delaySeconds, limitSeconds) =>
        s"reason=$reason delaySeconds=$delaySeconds limitSeconds=$limitSeconds"
      case DeadLetterBacklogExceeded(length, limit) => s"reason=$reason length=$length limit=$limit"

  def allowAll[F[_]: Applicative]: OcrAdmissionGuard[F] = new OcrAdmissionGuard[F]:
    override def ensureAvailable: F[Either[AppError, Unit]] = Applicative[F]
      .pure(().asRight[AppError])
    override def healthStatus: F[String] = Applicative[F].pure("disabled")

  def from[F[_]: MonadThrow: Clock: LoggerFactory](
      outbox: OcrQueueOutboxRepository[F],
      queueHealth: QueueHealthProbe[F],
      config: Config,
  ): OcrAdmissionGuard[F] = LiveOcrAdmissionGuard(outbox, queueHealth, config)

private final class LiveOcrAdmissionGuard[F[_]: MonadThrow: Clock: LoggerFactory](
    outbox: OcrQueueOutboxRepository[F],
    queueHealth: QueueHealthProbe[F],
    config: OcrAdmissionGuard.Config,
) extends OcrAdmissionGuard[F]:
  import OcrAdmissionGuard.*

  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[LiveOcrAdmissionGuard[F]])
  private val serviceUnavailable = AppError
    .ServiceUnavailable("OCR queue is temporarily unavailable. Try again later.")

  override def ensureAvailable: F[Either[AppError, Unit]] = decision.flatMap {
    case Decision.Allowed => ().asRight[AppError].pure[F]
    case Decision.Rejected(rejection) => logger
        .warn(s"OCR admission rejected ${rejection.logFields}") >>
        serviceUnavailable.asLeft[Unit].pure[F]
  }

  override def healthStatus: F[String] = decision.map {
    case Decision.Allowed => "ok"
    case Decision.Rejected(rejection) => s"degraded:${rejection.reason}"
  }

  private def decision: F[Decision] = queueHealth.ping.attempt.flatMap {
    case Left(error) => Decision
        .Rejected(Rejection.RedisUnavailable(SafeLog.throwableClasses(error))).pure[F]
    case Right(_) =>
      for
        now <- Clock[F].realTimeInstant
        snapshotResult <- outbox.backlogSnapshot(now).attempt
        decision <- snapshotResult match
          case Left(error) => Decision
              .Rejected(Rejection.OutboxStatusUnavailable(SafeLog.throwableClasses(error))).pure[F]
          case Right(snapshot) => queueHealth.deadLetterLength.attempt.map {
              case Left(error) => Decision
                  .Rejected(Rejection.DeadLetterStatusUnavailable(SafeLog.throwableClasses(error)))
              case Right(deadLetterLength) => evaluate(snapshot, deadLetterLength, now)
            }
      yield decision
  }

  private def evaluate(
      snapshot: OcrQueueBacklogSnapshot,
      deadLetterLength: Long,
      now: Instant,
  ): Decision =
    val maybeOldestDelayed = snapshot.oldestDueNextAttemptAt.flatMap { oldestDue =>
      val delay = JavaDuration.between(oldestDue, now).toMillis.millis
      Option.when(delay > config.oldestDueMaxDelay) {
        Rejection.OldestDueDelayed(delay.toSeconds, config.oldestDueMaxDelay.toSeconds)
      }
    }

    val rejection = List(
      Option.when(snapshot.dueBacklogCount > config.dueBacklogLimit.toLong) {
        Rejection.DueBacklogExceeded(snapshot.dueBacklogCount, config.dueBacklogLimit)
      },
      Option.when(snapshot.activeBacklogCount > config.activeBacklogLimit.toLong) {
        Rejection.ActiveBacklogExceeded(snapshot.activeBacklogCount, config.activeBacklogLimit)
      },
      maybeOldestDelayed,
      Option.when(deadLetterLength > config.deadLetterBacklogLimit.toLong) {
        Rejection.DeadLetterBacklogExceeded(deadLetterLength, config.deadLetterBacklogLimit)
      },
    ).flatten.headOption

    rejection.fold(Decision.Allowed)(reason => Decision.Rejected(reason))
