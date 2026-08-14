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
import momo.api.repositories.SeriesAnalysisRepository

final class PostgresSeriesAnalysisRepository[F[_]: Async] private (
    transactor: Transactor[F],
    readConfig: SeriesAnalysisReadConfig,
    decodeSemaphore: Semaphore[F],
) extends SeriesAnalysisRepository[F]:

  override def options: F[Either[AppError, SeriesAnalysisOptions]] =
    PostgresSeriesAnalysisReadOps.options.transact(transactor)

  override def status(
      gameTitleId: GameTitleId
  ): F[Either[AppError, SeriesAnalysisStatus]] =
    PostgresSeriesAnalysisReadOps.status(gameTitleId).transact(transactor)

  override def chunk(
      request: SeriesAnalysisChunkRequest
  ): F[Either[AppError, SeriesAnalysisChunk]] =
    PostgresSeriesAnalysisRepository.boundedChunkRead(decodeSemaphore, readConfig)(
      chunkPipeline(request)
    )

  /**
   * Keeps the memory/decode permit for the complete read while releasing database connections
   * before checksum, JSON decoding, hydration and response sizing. Artifact bytes belong to the
   * first snapshot; display names are intentionally resolved from a second, short live snapshot.
   */
  private def chunkPipeline(
      request: SeriesAnalysisChunkRequest
  ): F[Either[AppError, SeriesAnalysisChunk]] = transactChunk(
    PostgresSeriesAnalysisChunkOps.load(request, readConfig)
  ).flatMap {
    case Left(error) => error.asLeft[SeriesAnalysisChunk].pure[F]
    case Right(loaded) =>
      Async[F].blocking(decodeAndCollectMemberIds(loaded)).flatMap {
        case Left(error) => error.asLeft[SeriesAnalysisChunk].pure[F]
        case Right((chunk, memberIds)) =>
          transactChunk(
            PostgresSeriesAnalysisChunkOps
              .displayMetadata(chunk, memberIds, readConfig).map(_.asRight[AppError])
          ).flatMap {
            case Left(error) => error.asLeft[SeriesAnalysisChunk].pure[F]
            case Right(metadata) => Async[F].blocking(
                PostgresSeriesAnalysisChunkCodec.hydrate(
                  chunk,
                  memberIds,
                  metadata.memberNames,
                  metadata.scopeName,
                  readConfig,
                )
              )
          }
      }
  }

  private def transactChunk[A](
      read: ConnectionIO[Either[AppError, A]]
  ): F[Either[AppError, A]] = read.exceptSomeSqlState {
    case state if state.value == PostgresSeriesAnalysisRepository.QueryCanceledSqlState =>
      AppError.AnalysisReadBusy(readConfig.busyRetryAfterSeconds).asLeft[A].pure[ConnectionIO]
  }.transact(transactor)

  private def decodeAndCollectMemberIds(
      loaded: PostgresSeriesAnalysisChunkOps.LoadedChunk
  ): Either[AppError, (SeriesAnalysisChunk, List[String])] =
    val decoded = loaded.material match
      case PostgresSeriesAnalysisChunkOps.ChunkMaterial.Excluded(artifact, matchId, reason) =>
        PostgresSeriesAnalysisChunkCodec
          .excludedContext(artifact, loaded.request.scope, matchId, reason).asRight
      case PostgresSeriesAnalysisChunkOps.ChunkMaterial.Stored(row, sourceMatchRevision) =>
        PostgresSeriesAnalysisChunkCodec
          .decode(row, loaded.request, readConfig, sourceMatchRevision)
          .map(chunk =>
            sourceMatchRevision.fold(chunk)(revision =>
              PostgresSeriesAnalysisChunkCodec.includedContext(chunk, revision)
            )
          )
    decoded.flatMap(chunk =>
      PostgresSeriesAnalysisChunkCodec.memberIds(chunk.payload).map(chunk -> _)
    )

  override def adminOverview(
      gameTitleId: Option[GameTitleId]
  ): F[Either[AppError, SeriesAnalysisAdminOverview]] =
    PostgresSeriesAnalysisAdminOps.overview(gameTitleId).transact(transactor)

  override def requestTitleRecalculation(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = freshIds(4).flatMap { ids =>
    PostgresSeriesAnalysisTitleRequestOps
      .requestTitle(gameTitleId, requestedBy, idempotencyKeyHash, ids).transact(transactor)
  }

  override def requestAllRecalculation(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = freshIds(2).flatMap { ids =>
    PostgresSeriesAnalysisCampaignRequestOps
      .requestAll(requestedBy, idempotencyKeyHash, ids).transact(transactor)
  }

  private def freshIds(count: Int): F[List[String]] = List
    .fill(count)(Async[F].delay(UUID.randomUUID().toString)).sequence

object PostgresSeriesAnalysisRepository:
  private val QueryCanceledSqlState = "57014"

  def create[F[_]: Async](
      transactor: Transactor[F],
      readConfig: SeriesAnalysisReadConfig,
  ): F[PostgresSeriesAnalysisRepository[F]] = Semaphore[F](readConfig.decodeConcurrency.toLong)
    .map(new PostgresSeriesAnalysisRepository(transactor, readConfig, _))

  private[postgres] def boundedChunkRead[F[_]: Async](
      semaphore: Semaphore[F],
      config: SeriesAnalysisReadConfig,
  )(
      read: F[Either[AppError, SeriesAnalysisChunk]]
  ): F[Either[AppError, SeriesAnalysisChunk]] = semaphore.tryAcquire.flatMap {
    case false => AppError.AnalysisReadBusy(config.busyRetryAfterSeconds)
        .asLeft[SeriesAnalysisChunk].pure[F]
    case true => read.timeoutTo(
        config.readTimeout,
        AppError.AnalysisReadBusy(config.busyRetryAfterSeconds)
          .asLeft[SeriesAnalysisChunk].pure[F],
      ).guarantee(semaphore.release)
  }

end PostgresSeriesAnalysisRepository
