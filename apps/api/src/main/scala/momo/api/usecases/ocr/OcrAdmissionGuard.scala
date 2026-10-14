package momo.api.usecases.ocr

import java.time.{Duration as JavaDuration, Instant}

import scala.concurrent.duration.*

import cats.effect.Clock
import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.OcrJobBacklogSnapshot

trait OcrAdmissionGuard[F[_]]:
  def ensureAvailable: F[Either[AppError, Unit]]
  def healthStatus: F[String]

object OcrAdmissionGuard:
  final case class Config(activeJobLimit: Int, oldestReadyMaxDelay: FiniteDuration)

  enum Decision derives CanEqual:
    case Allowed
    case Rejected(reason: Rejection)

  enum Rejection derives CanEqual:
    case JobStatusUnavailable(errorClasses: String)
    case ActiveJobLimitReached(count: Long, limit: Int)
    case OldestReadyDelayed(delaySeconds: Long, limitSeconds: Long)

    def reason: String = this match
      case JobStatusUnavailable(_) => "job_status_unavailable"
      case ActiveJobLimitReached(_, _) => "active_job_limit_reached"
      case OldestReadyDelayed(_, _) => "oldest_ready_job_delayed"

    def logFields: String = this match
      case JobStatusUnavailable(errorClasses) => s"reason=$reason errorClasses=$errorClasses"
      case ActiveJobLimitReached(count, limit) => s"reason=$reason count=$count limit=$limit"
      case OldestReadyDelayed(delaySeconds, limitSeconds) =>
        s"reason=$reason delaySeconds=$delaySeconds limitSeconds=$limitSeconds"

  def allowAll[F[_]: Applicative]: OcrAdmissionGuard[F] = new OcrAdmissionGuard[F]:
    override def ensureAvailable: F[Either[AppError, Unit]] = Applicative[F]
      .pure(().asRight[AppError])
    override def healthStatus: F[String] = Applicative[F].pure("disabled")

  def from[F[_]: MonadThrow: Clock: LoggerFactory](
      backlogSnapshot: Instant => F[OcrJobBacklogSnapshot],
      config: Config,
  ): OcrAdmissionGuard[F] = LiveOcrAdmissionGuard(backlogSnapshot, config)

  private[ocr] def evaluate(
      snapshot: OcrJobBacklogSnapshot,
      now: Instant,
      config: Config,
  ): Decision =
    if snapshot.activeCount >= config.activeJobLimit.toLong then
      Decision.Rejected(Rejection.ActiveJobLimitReached(
        snapshot.activeCount,
        config.activeJobLimit
      ))
    else
      snapshot.oldestReadyAt.flatMap { readyAt =>
        val delay = JavaDuration.between(readyAt, now).toMillis.millis
        Option.when(delay > config.oldestReadyMaxDelay) {
          Decision.Rejected(Rejection.OldestReadyDelayed(
            delay.toSeconds,
            config.oldestReadyMaxDelay.toSeconds
          ))
        }
      }.getOrElse(Decision.Allowed)

private final class LiveOcrAdmissionGuard[F[_]: MonadThrow: Clock: LoggerFactory](
    backlogSnapshot: Instant => F[OcrJobBacklogSnapshot],
    config: OcrAdmissionGuard.Config,
) extends OcrAdmissionGuard[F]:
  import OcrAdmissionGuard.*

  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[LiveOcrAdmissionGuard[F]])
  private val serviceUnavailable = AppError
    .ServiceUnavailable("OCR processing is temporarily unavailable. Try again later.")

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

  private def decision: F[Decision] =
    for
      now <- Clock[F].realTimeInstant
      snapshot <- backlogSnapshot(now).attempt
    yield snapshot match
      case Left(error) => Decision
          .Rejected(Rejection.JobStatusUnavailable(SafeLog.throwableClasses(error)))
      case Right(value) => OcrAdmissionGuard.evaluate(value, now, config)
