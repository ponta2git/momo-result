package momo.api.usecases.queue

import cats.effect.std.Queue
import cats.effect.{Concurrent, Ref, Resource}
import cats.syntax.all.*

enum WorkerWakeKind derives CanEqual:
  case ProcessingJobs
  case OcrSubmissions

final case class PostCommitEffects private (
    private[queue] val wakeKinds: Set[WorkerWakeKind]
) derives CanEqual:
  def ++(other: PostCommitEffects): PostCommitEffects = PostCommitEffects(
    wakeKinds ++ other.wakeKinds
  )

  def isEmpty: Boolean = wakeKinds.isEmpty

  def contains(kind: WorkerWakeKind): Boolean = wakeKinds.contains(kind)

object PostCommitEffects:
  val empty: PostCommitEffects = PostCommitEffects(Set.empty)

  def wake(kind: WorkerWakeKind): PostCommitEffects = PostCommitEffects(Set(kind))

  def wakeAll(first: WorkerWakeKind, rest: WorkerWakeKind*): PostCommitEffects = PostCommitEffects(
    rest.toSet + first
  )

enum WorkerWakeSubmitResult derives CanEqual:
  /** The signal was accepted or coalesced with an already pending signal. */
  case Accepted

  /** The runtime is shutting down. The committed operation must remain successful. */
  case Closed

/**
 * Accepts bounded process-local hints after a durable commit. Submission must not wait for
 * external I/O: callers mask cancellation only while handing off an already committed result.
 * A Resource-owned relay sends accepted hints to the Worker.
 */
trait WorkerWakeSink[F[_]]:
  def submit(effects: PostCommitEffects): F[WorkerWakeSubmitResult]

/**
 * Process-local, non-durable hints that a Worker task may have work.
 *
 * Each kind has capacity one: duplicate submissions coalesce and carry no row ID or payload. Only
 * submit after the transaction that wrote the durable DB state has committed. Losing or closing
 * this signal cannot lose the durable intent, and a closed sink is reported as data rather than
 * failing an already committed producer operation.
 */
final class WorkerWakeup[F[_]] private (
    queues: Map[WorkerWakeKind, Queue[F, Unit]],
    closed: Ref[F, Boolean],
)(using concurrent: Concurrent[F])
    extends WorkerWakeSink[F]:

  override def submit(effects: PostCommitEffects): F[WorkerWakeSubmitResult] = concurrent
    .uncancelable(_ =>
      closed.get.flatMap {
        case true => WorkerWakeSubmitResult.Closed.pure[F]
        case false => effects.wakeKinds.toList
            .traverse_(kind => queueFor(kind).tryOffer(()).void)
            .as(WorkerWakeSubmitResult.Accepted)
      }
    )

  private[queue] def await(kind: WorkerWakeKind): F[Unit] = queueFor(kind).take

  private[queue] def tryAwait(kind: WorkerWakeKind): F[Option[Unit]] = queueFor(kind).tryTake

  private[queue] def close: F[Unit] = closed.set(true)

  private def queueFor(kind: WorkerWakeKind): Queue[F, Unit] = queues(kind)

object WorkerWakeup:
  def create[F[_]: Concurrent]: F[WorkerWakeup[F]] =
    for
      queues <- WorkerWakeKind.values.toList.traverse(kind => Queue.bounded[F, Unit](1).tupleLeft(kind))
      closed <- Ref.of[F, Boolean](false)
    yield new WorkerWakeup(queues.toMap, closed)

  def resource[F[_]: Concurrent]: Resource[F, WorkerWakeup[F]] = Resource
    .make(create[F])(_.close)
