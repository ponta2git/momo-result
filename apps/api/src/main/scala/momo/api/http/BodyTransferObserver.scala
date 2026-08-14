package momo.api.http

import scala.concurrent.duration.FiniteDuration

import cats.effect.kernel.Resource.ExitCase
import cats.effect.{Async, Clock, Ref}
import cats.syntax.all.*
import fs2.Stream

private[api] enum BodyTransferOutcome(val wire: String) derives CanEqual:
  case Succeeded extends BodyTransferOutcome("succeeded")
  case Errored extends BodyTransferOutcome("errored")
  case Canceled extends BodyTransferOutcome("canceled")

private[api] final case class BodyTransferResult(
    outcome: BodyTransferOutcome,
    bodyBytes: Long,
    startedAt: FiniteDuration,
    finishedAt: FiniteDuration,
    errorClass: Option[String],
):
  def duration: FiniteDuration = finishedAt - startedAt

/**
 * Observes the actual response-body consumption boundary, including cancellation.
 *
 * The callback runs exactly once when the returned stream terminates. Merely constructing a
 * response does not report a successful transfer.
 */
private[api] object BodyTransferObserver:
  private given CanEqual[ExitCase, ExitCase] = CanEqual.derived

  def apply[F[_]: Async](body: Stream[F, Byte])(
      onComplete: BodyTransferResult => F[Unit]
  ): Stream[F, Byte] = Stream.eval((Clock[F].monotonic, Ref.of[F, Long](0L)).tupled).flatMap {
    case (startedAt, bodyBytes) =>
      body.chunks
        .evalTap(chunk => bodyBytes.update(current => saturatedAdd(current, chunk.size.toLong)))
        .flatMap(Stream.chunk)
        .onFinalizeCase(exitCase =>
          (bodyBytes.get, Clock[F].monotonic).mapN { (count, finishedAt) =>
            BodyTransferResult(
              outcome(exitCase),
              count,
              startedAt,
              finishedAt,
              errorClass(exitCase),
            )
          }.flatMap(onComplete)
        )
  }

  private def outcome(exitCase: ExitCase): BodyTransferOutcome = exitCase match
    case ExitCase.Succeeded => BodyTransferOutcome.Succeeded
    case ExitCase.Errored(_) => BodyTransferOutcome.Errored
    case ExitCase.Canceled => BodyTransferOutcome.Canceled

  private def errorClass(exitCase: ExitCase): Option[String] = exitCase match
    case ExitCase.Errored(error) => Some(error.getClass.getName)
    case ExitCase.Succeeded | ExitCase.Canceled => None

  private def saturatedAdd(left: Long, right: Long): Long =
    if right > 0L && left > Long.MaxValue - right then Long.MaxValue else left + right
