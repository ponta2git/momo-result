package momo.api.usecases.queue

import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.Async
import cats.syntax.all.*
import fs2.concurrent.SignallingRef

/** Process-local hints. A changed boot requires recovery of a possibly unresolved transaction. */
trait WorkerWakeSink[F[_]]:
  def signal: F[Unit]
  def uncertain: F[Unit]

final case class WorkerWakeCursor(boot: UUID, counter: Long) derives CanEqual:
  def unsignedCounter: String = java.lang.Long.toUnsignedString(counter)

final class WorkerWakeup[F[_]: Async] private (
    state: SignallingRef[F, WorkerWakeCursor]
) extends WorkerWakeSink[F]:
  def advance: F[WorkerWakeCursor] = state.updateAndGet(s => s.copy(counter = s.counter + 1L))

  def invalidate: F[WorkerWakeCursor] =
    Async[F].delay(UUID.randomUUID()).flatMap(boot =>
      state.updateAndGet(_ => WorkerWakeCursor(boot, 0L))
    )

  def signal: F[Unit] = advance.void
  def uncertain: F[Unit] = invalidate.void

  def await(previous: Option[WorkerWakeCursor]): F[WorkerWakeCursor] = previous match
    case None => state.get
    case Some(cursor) =>
      // discrete emits its initial value and then updates, including a wake racing registration.
      Async[F].timeoutTo(
        state.discrete.find(_ != cursor).compile.lastOrError,
        30.seconds,
        state.get,
      )

object WorkerWakeup:
  def create[F[_]: Async]: F[WorkerWakeup[F]] =
    for
      boot <- Async[F].delay(UUID.randomUUID())
      state <- SignallingRef[F, WorkerWakeCursor](WorkerWakeCursor(boot, 0L))
    yield new WorkerWakeup(state)
