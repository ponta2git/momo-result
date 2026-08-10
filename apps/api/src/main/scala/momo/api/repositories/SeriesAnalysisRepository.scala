package momo.api.repositories

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError

trait SeriesAnalysisRepository[F[_]]:
  def options: F[Either[AppError, SeriesAnalysisOptions]]
  def status(gameTitleId: GameTitleId): F[Either[AppError, SeriesAnalysisStatus]]
  def chunk(request: SeriesAnalysisChunkRequest): F[Either[AppError, SeriesAnalysisChunk]]
  def adminOverview(
      gameTitleId: Option[GameTitleId]
  ): F[Either[AppError, SeriesAnalysisAdminOverview]]
  def requestTitleRecalculation(
      gameTitleId: GameTitleId,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]]
  def requestAllRecalculation(
      requestedBy: AccountId,
      idempotencyKeyHash: String,
  ): F[Either[AppError, SeriesAnalysisRecalculationAccepted]]
