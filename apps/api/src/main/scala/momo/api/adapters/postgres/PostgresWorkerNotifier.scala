package momo.api.adapters.postgres

import scala.concurrent.duration.DurationInt

import cats.effect.Temporal
import doobie.*
import doobie.implicits.*

/** Relays coalesced hints outside HTTP requests. Durable jobs remain authoritative. */
final class PostgresWorkerNotifier[F[_]: Temporal](
    transactor: Transactor[F],
    channel: PostgresWorkerNotifier.Channel,
):
  def notifyWorker: F[Unit] = Temporal[F].timeout(
    sql"SELECT pg_notify(${channel.value}, '')".query[Unit].unique.transact(transactor),
    500.millis,
  )

object PostgresWorkerNotifier:
  enum Channel(val value: String):
    case ProcessingJobs extends Channel("processing_jobs")
    case OcrSubmissions extends Channel("ocr_submissions")
