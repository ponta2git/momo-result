package momo.api.bootstrap

import cats.Monad

import momo.api.http.modules.{SeriesAnalysisModule, SeriesPlayerRadarModule}
import momo.api.repositories.{SeriesAnalysisRepository, SeriesPlayerRadarRepository}
import momo.api.usecases.seriesanalysis.*

private[bootstrap] object AnalysisUseCaseWiring:
  def analysis[F[_]](
      repository: SeriesAnalysisRepository[F]
  ): SeriesAnalysisModule.UseCases[F] = SeriesAnalysisModule.UseCases(
    getOptions = GetSeriesAnalysisOptions[F](repository),
    getStatus = GetSeriesAnalysisStatus[F](repository),
    getChunk = GetSeriesAnalysisChunk[F](repository),
    getAdminOverview = GetSeriesAnalysisAdminOverview[F](repository),
    requestRecalculation = RequestSeriesAnalysisRecalculation[F](repository),
  )

  def radar[F[_]: Monad](
      repository: SeriesPlayerRadarRepository[F]
  ): SeriesPlayerRadarModule.UseCases[F] = SeriesPlayerRadarModule.UseCases(
    getHistory = GetSeriesPlayerRadarHistory[F](repository),
    getState = GetSeriesPlayerRadarState[F](repository),
    getPreview = GetSeriesPlayerRadarPreview[F](repository),
    getOperation = GetSeriesPlayerRadarOperation[F](repository),
    requestOperation = RequestSeriesPlayerRadarOperation[F](repository),
  )
