package momo.api.adapters.postgres

import scala.concurrent.duration.DurationInt

import cats.effect.Temporal
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.usecases.queue.{OutboxDrainResult, OutboxWakeDriver}

/**
 * Relays coalesced process-local hints outside the HTTP request. Each invocation sends one
 * payloadless notification; the worker owns durable outbox draining and missed-hint recovery.
 */
final class PostgresOutboxNotifier[F[_]: Temporal](
    transactor: Transactor[F],
    channel: PostgresOutboxNotifier.Channel,
) extends OutboxWakeDriver[F]:
  override def drainBatch: F[OutboxDrainResult] =
    Temporal[F].timeout(
      sql"SELECT pg_notify(${channel.value}, '')".query[Unit].unique.transact(transactor),
      500.millis,
    ).as(OutboxDrainResult.Idle(None))

object PostgresOutboxNotifier:
  enum Channel(val value: String):
    case SeriesAnalysis extends Channel("series_analysis_queue_outbox")
    case OcrSubmissions extends Channel("ocr_submissions")
