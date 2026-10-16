package momo.api.usecases.seriesanalysis

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.SeriesAnalysisRepository
import momo.api.util.Sha256

final class GetSeriesAnalysisOptions[F[_]](repository: SeriesAnalysisRepository[F]):
  def run: F[Either[AppError, SeriesAnalysisOptions]] = repository.options

final class GetSeriesAnalysisStatus[F[_]](repository: SeriesAnalysisRepository[F]):
  def run(gameTitleId: GameTitleId): F[Either[AppError, SeriesAnalysisStatus]] = repository
    .status(gameTitleId)

  def scope(request: SeriesAnalysisScopeStatusRequest)
      : F[Either[AppError, SeriesAnalysisScopeStatus]] =
    repository.scopeStatus(request)

final class GetSeriesAnalysisChunk[F[_]](repository: SeriesAnalysisRepository[F]):
  def run(request: SeriesAnalysisChunkRequest): F[Either[AppError, SeriesAnalysisChunk]] =
    repository
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
    .requestTitleRecalculation(gameTitleId, accountId, Sha256.hexUtf8(idempotencyKey))

  def all(
      accountId: AccountId,
      idempotencyKey: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = repository
    .requestAllRecalculation(accountId, Sha256.hexUtf8(idempotencyKey))
