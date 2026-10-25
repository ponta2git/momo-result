package momo.api.repositories

import java.util.UUID

import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MatchId}
import momo.api.errors.AppError

trait AchievementsRepository[F[_]]:
  def catalog(gameTitleId: GameTitleId): F[Either[AppError, AchievementCatalog]]
  def reorder(command: ReorderAchievements): F[Either[AppError, AchievementCatalog]]
  def create(command: CreateAchievement, context: AchievementMutationContext)
      : F[Either[AppError, AchievementItem]]
  def update(id: UUID, command: UpdateAchievement, context: AchievementMutationContext)
      : F[Either[AppError, AchievementItem]]
  def retire(id: UUID, expectedVersion: Long, context: AchievementMutationContext)
      : F[Either[AppError, AchievementItem]]
  def correctClaim(id: UUID, command: CorrectAchievementClaim, context: AchievementMutationContext)
      : F[Either[AppError, AchievementClaim]]
  def addToMatch(id: MatchId, command: AddMatchAchievements, context: AchievementMutationContext)
      : F[Either[AppError, Unit]]
