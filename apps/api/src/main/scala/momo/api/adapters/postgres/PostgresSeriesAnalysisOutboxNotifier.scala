package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.usecases.queue.{OutboxDrainResult, OutboxWakeDriver}

/**
 * Relays coalesced process-local hints outside the HTTP request. Each invocation sends one
 * payloadless notification; the worker owns durable outbox draining and missed-hint recovery.
 */
final class PostgresSeriesAnalysisOutboxNotifier[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends OutboxWakeDriver[F]:
  import PostgresSeriesAnalysisOutboxNotifier.Channel

  override def drainBatch: F[OutboxDrainResult] =
    sql"SELECT pg_notify($Channel, '')".query[Unit].unique
      .transact(transactor)
      .as(OutboxDrainResult.Idle(None))

object PostgresSeriesAnalysisOutboxNotifier:
  val Channel: String = "series_analysis_queue_outbox"
