package momo.api.bootstrap

import cats.effect.Sync

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.{SeriesAnalysisRepository, SeriesPlayerRadarRepository}

/** Analysis persistence is intentionally absent from the lightweight HTTP fixture. */
private[bootstrap] object UnsupportedAnalysisRepositories:
  private def unsupported[F[_]: Sync, A]: F[A] = Sync[F].raiseError(
    new IllegalStateException("Analysis persistence requires PostgresHttpAppTestFixtures.")
  )

  def analysis[F[_]: Sync]: SeriesAnalysisRepository[F] = new SeriesAnalysisRepository[F]:
    override def options: F[Either[AppError, SeriesAnalysisOptions]] = unsupported
    override def status(id: GameTitleId): F[Either[AppError, SeriesAnalysisStatus]] = unsupported
    override def scopeStatus(request: SeriesAnalysisScopeStatusRequest)
        : F[Either[AppError, SeriesAnalysisScopeStatus]] = unsupported
    override def chunk(request: SeriesAnalysisChunkRequest)
        : F[Either[AppError, SeriesAnalysisChunk]] = unsupported
    override def adminOverview(id: Option[GameTitleId])
        : F[Either[AppError, SeriesAnalysisAdminOverview]] = unsupported
    override def requestTitleRecalculation(id: GameTitleId, actor: AccountId, key: String)
        : F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = unsupported
    override def requestAllRecalculation(actor: AccountId, key: String)
        : F[Either[AppError, SeriesAnalysisRecalculationAccepted]] = unsupported

  def radar[F[_]: Sync]: SeriesPlayerRadarRepository[F] = new SeriesPlayerRadarRepository[F]:
    override def radarState(id: GameTitleId)
        : F[Either[AppError, SeriesPlayerRadarDocument]] = unsupported
    override def radarHistory(request: SeriesPlayerRadarHistoryRequest)
        : F[Either[AppError, SeriesPlayerRadarDocument]] = unsupported
    override def radarRevision(id: String)
        : F[Either[AppError, SeriesPlayerRadarDocument]] = unsupported
    override def radarPreview(request: SeriesPlayerRadarPreviewRequest)
        : F[Either[AppError, SeriesPlayerRadarDocument]] = unsupported
    override def radarOperation(title: GameTitleId, id: String)
        : F[Either[AppError, SeriesPlayerRadarOperation]] = unsupported
    override def requestRadarOperation(command: SeriesPlayerRadarCommand, actor: AccountId,
        key: String, fingerprint: String)
        : F[Either[AppError, SeriesPlayerRadarOperation]] = unsupported
