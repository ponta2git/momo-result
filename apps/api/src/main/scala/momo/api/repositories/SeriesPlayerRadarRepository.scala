package momo.api.repositories

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError

trait SeriesPlayerRadarRepository[F[_]]:
  def radarState(gameTitleId: GameTitleId): F[Either[AppError, SeriesPlayerRadarDocument]]
  def radarPreview(
      request: SeriesPlayerRadarPreviewRequest
  ): F[Either[AppError, SeriesPlayerRadarDocument]]
  def radarOperation(
      gameTitleId: GameTitleId,
      operationId: String,
  ): F[Either[AppError, SeriesPlayerRadarOperation]]
  def requestRadarOperation(
      command: SeriesPlayerRadarCommand,
      requestedBy: AccountId,
      idempotencyKeyHash: String,
      requestFingerprint: String,
  ): F[Either[AppError, SeriesPlayerRadarOperation]]
