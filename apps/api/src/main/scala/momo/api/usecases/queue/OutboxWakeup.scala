package momo.api.usecases.queue

import cats.effect.std.Queue
import cats.effect.{Concurrent, Ref, Resource}
import cats.syntax.all.*

enum OutboxKind derives CanEqual:
  case Ocr
  case SeriesAnalysis

final case class PostCommitEffects private (
    private[queue] val outboxKinds: Set[OutboxKind]
) derives CanEqual:
  def ++(other: PostCommitEffects): PostCommitEffects = PostCommitEffects(
    outboxKinds ++ other.outboxKinds
  )

  def isEmpty: Boolean = outboxKinds.isEmpty

  def contains(kind: OutboxKind): Boolean = outboxKinds.contains(kind)

object PostCommitEffects:
  val empty: PostCommitEffects = PostCommitEffects(Set.empty)

  def wake(kind: OutboxKind): PostCommitEffects = PostCommitEffects(Set(kind))

  def wakeAll(first: OutboxKind, rest: OutboxKind*): PostCommitEffects = PostCommitEffects(
    rest.toSet + first
  )

enum OutboxWakeSubmitResult derives CanEqual:
  /** The signal was accepted or coalesced with an already pending signal. */
  case Accepted

  /** The runtime is shutting down. The committed operation must remain successful. */
  case Closed

trait OutboxWakeSink[F[_]]:
  def submit(effects: PostCommitEffects): F[OutboxWakeSubmitResult]

/**
 * Process-local, non-durable hints that an outbox kind may have work.
 *
 * Each kind has capacity one: duplicate submissions coalesce and carry no row ID or payload. Only
 * submit after the transaction that wrote the durable DB outbox has committed. Losing or closing
 * this signal cannot lose the durable intent, and a closed sink is reported as data rather than
 * failing an already committed producer operation.
 */
final class OutboxWakeup[F[_]] private (
    queues: Map[OutboxKind, Queue[F, Unit]],
    closed: Ref[F, Boolean],
)(using concurrent: Concurrent[F])
    extends OutboxWakeSink[F]:

  override def submit(effects: PostCommitEffects): F[OutboxWakeSubmitResult] = concurrent
    .uncancelable(_ =>
      closed.get.flatMap {
        case true => OutboxWakeSubmitResult.Closed.pure[F]
        case false => effects.outboxKinds.toList
            .traverse_(kind => queueFor(kind).tryOffer(()).void)
            .as(OutboxWakeSubmitResult.Accepted)
      }
    )

  private[queue] def await(kind: OutboxKind): F[Unit] = queueFor(kind).take

  private[queue] def tryAwait(kind: OutboxKind): F[Option[Unit]] = queueFor(kind).tryTake

  private[queue] def close: F[Unit] = closed.set(true)

  private def queueFor(kind: OutboxKind): Queue[F, Unit] = queues(kind)

object OutboxWakeup:
  def create[F[_]: Concurrent]: F[OutboxWakeup[F]] =
    for
      queues <- OutboxKind.values.toList.traverse(kind => Queue.bounded[F, Unit](1).tupleLeft(kind))
      closed <- Ref.of[F, Boolean](false)
    yield new OutboxWakeup(queues.toMap, closed)

  def resource[F[_]: Concurrent]: Resource[F, OutboxWakeup[F]] = Resource
    .make(create[F])(_.close)
