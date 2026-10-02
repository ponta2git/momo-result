package momo.api.adapters.postgres

import java.util.UUID

import cats.effect.Async
import cats.effect.std.Semaphore
import cats.effect.syntax.all.*
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.SeriesPlayerRadarRepository

final class PostgresSeriesPlayerRadarRepository[F[_]: Async] private (
    transactor: Transactor[F],
    config: SeriesAnalysisReadConfig,
    readPermits: Semaphore[F],
) extends SeriesPlayerRadarRepository[F]:
  override def radarState(title: GameTitleId): F[Either[AppError, SeriesPlayerRadarDocument]] =
    read(PostgresSeriesPlayerRadarReadOps.state(title))

  override def radarPreview(request: SeriesPlayerRadarPreviewRequest)
      : F[Either[AppError, SeriesPlayerRadarDocument]] =
    read(PostgresSeriesPlayerRadarReadOps.preview(request))

  override def radarOperation(title: GameTitleId, operationId: String)
      : F[Either[AppError, SeriesPlayerRadarOperation]] =
    read(PostgresSeriesPlayerRadarReadOps.operation(title, operationId))

  override def requestRadarOperation(
      command: SeriesPlayerRadarCommand,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      requestFingerprint: String,
  ): F[Either[AppError, SeriesPlayerRadarOperation]] =
    (freshId, freshId, freshId).tupled.flatMap { case (operation, candidate, preview) =>
      PostgresSeriesPlayerRadarCommandOps.request(
        command,
        requestedBy,
        idempotencyKeyHash,
        requestFingerprint,
        PostgresSeriesPlayerRadarCommandOps.FreshIds(operation, candidate, preview),
      ).transact(transactor)
    }

  private def freshId: F[String] = Async[F].delay(UUID.randomUUID().toString)

  private def read[A](query: ConnectionIO[Either[AppError, A]]): F[Either[AppError, A]] =
    readPermits.tryPermit.use {
      case false => AppError.AnalysisReadBusy(config.busyRetryAfterSeconds).asLeft[A].pure[F]
      case true =>
        val timeout = s"${config.readTimeout.toMillis}ms"
        (sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run *>
          sql"SELECT set_config('statement_timeout', $timeout, true)".query[String].unique *>
          query).exceptSomeSqlState {
          case state if state.value == "57014" =>
            AppError.AnalysisReadBusy(config.busyRetryAfterSeconds).asLeft[A].pure[ConnectionIO]
        }.transact(transactor).timeoutTo(
          config.readTimeout,
          AppError.AnalysisReadBusy(config.busyRetryAfterSeconds).asLeft[A].pure[F]
        )
    }

object PostgresSeriesPlayerRadarRepository:
  def create[F[_]: Async](transactor: Transactor[F], config: SeriesAnalysisReadConfig)
      : F[PostgresSeriesPlayerRadarRepository[F]] =
    Async[F].delay(SeriesPlayerRadarPayloadValidator.ensureReady()) *>
      Semaphore[F](config.decodeConcurrency.toLong)
        .map(new PostgresSeriesPlayerRadarRepository(transactor, config, _))
