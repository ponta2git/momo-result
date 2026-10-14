package momo.api.usecases.queue

import scala.concurrent.duration.*

import cats.effect.kernel.Outcome
import cats.effect.syntax.all.*
import cats.effect.{Resource, Temporal}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory

/** Owns notification I/O and retries; HTTP mutations only submit a bounded local hint. */
final class WorkerWakeRelay[F[_]: Temporal: LoggerFactory](
    kind: WorkerWakeKind,
    wakeup: WorkerWakeup[F],
    notifyWorker: F[Unit],
):
  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[WorkerWakeRelay[F]])

  def run: F[Unit] = relay(consecutiveFailures = 0)

  private def relay(consecutiveFailures: Int): F[Unit] = notifyWorker.attempt.flatMap {
    case Right(_) => wakeup.await(kind) >> relay(consecutiveFailures = 0)
    case Left(error) =>
      val retryAfter = WorkerWakeRelay.RetryBackoffs(
        math.min(consecutiveFailures, WorkerWakeRelay.RetryBackoffs.size - 1)
      )
      logger.error(
        s"Worker notification failed kind=$kind retryAfter=$retryAfter " +
          s"errorClass=${error.getClass.getName}"
      ) >> Temporal[F].sleep(retryAfter) >> wakeup.tryAwait(kind).void >>
        relay(consecutiveFailures + 1)
  }

object WorkerWakeRelay:
  private val RetryBackoffs = Vector(1, 2, 4, 8, 16, 32, 60).map(_.seconds)

  def resource[F[_]: Temporal: LoggerFactory](
      kind: WorkerWakeKind,
      wakeup: WorkerWakeup[F],
      notifyWorker: F[Unit],
      onUnexpectedExit: Throwable => F[Unit],
  ): Resource[F, Unit] = Resource.make(
    observeTermination(
      new WorkerWakeRelay(kind, wakeup, notifyWorker).run,
      kind,
      onUnexpectedExit,
    ).start
  )(_.cancel).void

  private[queue] def observeTermination[F[_]: Temporal](
      task: F[Unit],
      kind: WorkerWakeKind,
      onUnexpectedExit: Throwable => F[Unit],
  ): F[Unit] = task.guaranteeCase {
    case Outcome.Succeeded(_) => onUnexpectedExit(WorkerWakeRelayStopped(kind))
    case Outcome.Errored(error) => onUnexpectedExit(error)
    case Outcome.Canceled() => Temporal[F].unit
  }

  private final case class WorkerWakeRelayStopped(kind: WorkerWakeKind)
      extends RuntimeException(s"worker wake relay stopped unexpectedly: $kind")
