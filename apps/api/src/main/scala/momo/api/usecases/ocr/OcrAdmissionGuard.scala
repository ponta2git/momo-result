package momo.api.usecases.ocr

import java.time.{Duration as JavaDuration, Instant}

import scala.concurrent.duration.*

import cats.effect.Clock
import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.OcrQueueBacklogSnapshot

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
    case OutboxStatusUnavailable(errorClasses: String)
    case DeadLetterStatusUnavailable(errorClasses: String)
    case DueBacklogExceeded(count: Long, limit: Int)
    case ActiveBacklogExceeded(count: Long, limit: Int)
    case OldestDueDelayed(delaySeconds: Long, limitSeconds: Long)
    case DeadLetterBacklogExceeded(length: Long, limit: Int)

    def reason: String = this match
      case OutboxStatusUnavailable(_) => "outbox_status_unavailable"
      case DeadLetterStatusUnavailable(_) => "dead_letter_status_unavailable"
      case DueBacklogExceeded(_, _) => "outbox_due_backlog_exceeded"
      case ActiveBacklogExceeded(_, _) => "outbox_active_backlog_exceeded"
      case OldestDueDelayed(_, _) => "outbox_oldest_due_delayed"
      case DeadLetterBacklogExceeded(_, _) => "dead_letter_backlog_exceeded"

    def logFields: String = this match
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
      backlogSnapshot: Instant => F[OcrQueueBacklogSnapshot],
      deadLetterLength: F[Long],
      config: Config,
  ): OcrAdmissionGuard[F] = LiveOcrAdmissionGuard(backlogSnapshot, deadLetterLength, config)

  private[ocr] def evaluate(
      snapshot: OcrQueueBacklogSnapshot,
      deadLetterLength: Long,
      now: Instant,
      config: Config,
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

private final class LiveOcrAdmissionGuard[F[_]: MonadThrow: Clock: LoggerFactory](
    backlogSnapshot: Instant => F[OcrQueueBacklogSnapshot],
    deadLetterLength: F[Long],
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

  // Reading the required stream state also checks connectivity; a preceding PING cannot
  // guarantee the following command and only adds a network round trip.
  private def decision: F[Decision] = deadLetterLength.attempt.flatMap {
    case Left(error) => Decision
        .Rejected(Rejection.DeadLetterStatusUnavailable(SafeLog.throwableClasses(error))).pure[F]
    case Right(length) =>
      for
        now <- Clock[F].realTimeInstant
        snapshotResult <- backlogSnapshot(now).attempt
      yield snapshotResult match
        case Left(error) => Decision
            .Rejected(Rejection.OutboxStatusUnavailable(SafeLog.throwableClasses(error)))
        case Right(snapshot) => OcrAdmissionGuard.evaluate(snapshot, length, now, config)
  }
