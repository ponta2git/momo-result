package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.usecases.queue.{
  OutboxKind,
  OutboxWakeSink,
  OutboxWakeSubmitResult,
  PostCommitEffects
}

/**
 * Sends only a payloadless, best-effort hint after the durable analysis outbox transaction has
 * committed. PostgreSQL owns no delivery state here; the worker recovers missed hints from the
 * durable outbox.
 */
final class PostgresSeriesAnalysisOutboxWakeSink[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends OutboxWakeSink[F]:
  import PostgresSeriesAnalysisOutboxWakeSink.Channel

  override def submit(effects: PostCommitEffects): F[OutboxWakeSubmitResult] =
    if effects.contains(OutboxKind.SeriesAnalysis) then
      sql"SELECT pg_notify($Channel, '')".query[Unit].unique
        .transact(transactor)
        .as(OutboxWakeSubmitResult.Accepted)
    else OutboxWakeSubmitResult.Accepted.pure[F]

object PostgresSeriesAnalysisOutboxWakeSink:
  val Channel: String = "series_analysis_queue_outbox"
