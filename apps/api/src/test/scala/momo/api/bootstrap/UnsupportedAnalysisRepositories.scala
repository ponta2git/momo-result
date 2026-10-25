package momo.api.bootstrap

import java.util.UUID

import cats.effect.Sync

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId, MatchId}
import momo.api.errors.AppError
import momo.api.repositories.{
  AchievementsRepository,
  SeriesAnalysisRepository,
  SeriesPlayerRadarRepository
}

/** Analysis persistence is intentionally absent from the lightweight HTTP fixture. */
private[bootstrap] object UnsupportedAnalysisRepositories:
  def achievements[F[_]: Sync]: AchievementsRepository[F] = new AchievementsRepository[F]:
    def catalog(title: GameTitleId): F[Either[AppError, AchievementCatalog]] = unsupported
    def reorder(command: ReorderAchievements): F[Either[AppError, AchievementCatalog]] = unsupported
    def create(
        command: CreateAchievement,
        context: AchievementMutationContext
    ): F[Either[AppError, AchievementItem]] = unsupported
    def update(
        id: UUID,
        command: UpdateAchievement,
        context: AchievementMutationContext
    ): F[Either[AppError, AchievementItem]] = unsupported
    def retire(
        id: UUID,
        version: Long,
        context: AchievementMutationContext
    ): F[Either[AppError, AchievementItem]] = unsupported
    def correctClaim(
        id: UUID,
        command: CorrectAchievementClaim,
        context: AchievementMutationContext
    ): F[Either[AppError, AchievementClaim]] = unsupported
    def addToMatch(
        id: MatchId,
        command: AddMatchAchievements,
        context: AchievementMutationContext
    ): F[Either[AppError, Unit]] = unsupported

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
    override def requestRadarOperation(
        command: SeriesPlayerRadarCommand,
        actor: AccountId,
        key: String,
        fingerprint: String
    )
        : F[Either[AppError, SeriesPlayerRadarOperation]] = unsupported
