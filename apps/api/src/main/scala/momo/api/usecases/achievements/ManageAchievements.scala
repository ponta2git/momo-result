package momo.api.usecases.achievements

import java.time.Instant
import java.util.UUID

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId, MatchId}
import momo.api.errors.AppError
import momo.api.repositories.AchievementsRepository

final class ManageAchievements[F[_]: Monad](repository: AchievementsRepository[F], now: F[Instant]):
  def catalog(title: GameTitleId): F[Either[AppError, AchievementCatalog]] =
    repository.catalog(title)
  def create(command: CreateAchievement, actor: AccountId): F[Either[AppError, AchievementItem]] =
    now.flatMap(at => repository.create(command, AchievementMutationContext(actor, at)))
  def update(
      id: UUID,
      command: UpdateAchievement,
      actor: AccountId
  ): F[Either[AppError, AchievementItem]] =
    now.flatMap(at => repository.update(id, command, AchievementMutationContext(actor, at)))
  def retire(id: UUID, version: Long, actor: AccountId): F[Either[AppError, AchievementItem]] =
    now.flatMap(at => repository.retire(id, version, AchievementMutationContext(actor, at)))
  def correctClaim(
      id: UUID,
      command: CorrectAchievementClaim,
      actor: AccountId
  ): F[Either[AppError, AchievementClaim]] =
    now.flatMap(at => repository.correctClaim(id, command, AchievementMutationContext(actor, at)))
  def addToMatch(
      id: MatchId,
      command: AddMatchAchievements,
      actor: AccountId
  ): F[Either[AppError, Unit]] =
    now.flatMap(at => repository.addToMatch(id, command, AchievementMutationContext(actor, at)))
