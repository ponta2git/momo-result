package momo.api.usecases.seriesanalysis

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.SeriesAnalysisRepository

final class GetSeriesAnalysisOptions[F[_]](repository: SeriesAnalysisRepository[F]):
  def run: F[Either[AppError, SeriesAnalysisOptions]] = repository.options

final class GetSeriesAnalysisStatus[F[_]](repository: SeriesAnalysisRepository[F]):
  def run(gameTitleId: GameTitleId): F[Either[AppError, SeriesAnalysisStatus]] = repository
    .status(gameTitleId)

final class GetSeriesAnalysisChunk[F[_]](repository: SeriesAnalysisRepository[F]):
  def run(request: SeriesAnalysisChunkRequest): F[Either[AppError, SeriesAnalysisChunk]] = repository
    .chunk(request)

final class GetSeriesAnalysisAdminOverview[F[_]](repository: SeriesAnalysisRepository[F]):
  def run(
      gameTitleId: Option[GameTitleId]
  ): F[Either[AppError, SeriesAnalysisAdminOverview]] = repository.adminOverview(gameTitleId)

final class RequestSeriesAnalysisRecalculation[F[_]](
    repository: SeriesAnalysisRepository[F]
):
  def title(
      gameTitleId: GameTitleId,
      accountId: AccountId,
      idempotencyKey: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = repository
    .requestTitleRecalculation(gameTitleId, accountId, hashKey(idempotencyKey))

  def all(
      accountId: AccountId,
      idempotencyKey: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = repository
    .requestAllRecalculation(accountId, hashKey(idempotencyKey))

  private def hashKey(value: String): String =
    val bytes = value.getBytes(StandardCharsets.UTF_8)
    MessageDigest.getInstance("SHA-256").digest(bytes)
      .map(byte => f"${byte & 0xff}%02x").mkString
