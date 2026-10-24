package momo.api.adapters.postgres

import java.util.UUID

import cats.effect.Async
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MatchId}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{AchievementsRepository, RepositoryResult}

final class PostgresAchievementsRepository[F[_]: Async](
    transactor: Transactor[F],
    analysis: PostgresSeriesAnalysisRepository[F],
    identities: PostgresIdentities,
) extends AchievementsRepository[F]:
  private given PostgresIdentities = identities

  private def write[A](command: ConnectionIO[A]): F[Either[AppError, A]] =
    RepositoryResult.capture(command.exceptSomeSqlState {
      case state if isForeignKeyViolation(state) || isUniqueViolation(state) =>
        PostgresAchievementWriteOps.reject(
          "Achievement prerequisites changed. Refresh before saving."
        )
    }.transact(transactor))

  override def catalog(title: GameTitleId): F[Either[AppError, AchievementCatalog]] =
    RepositoryResult.capture(
      (sql"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY".update.run *>
        PostgresAchievementReadOps.catalog(title)).transact(transactor)
    )

  override def create(command: CreateAchievement, context: AchievementMutationContext)
      : F[Either[AppError, AchievementItem]] = write(
    for
      _ <- PostgresAchievementWriteOps.lockCreationReferences(command)
      // No existing item/root is acquired after this lock: new IDs cannot be targeted before commit.
      _ <- PostgresAchievementRetirementOps.state(command.gameTitleId, lock = true)
      catalog <- PostgresAchievementReadOps.forTitle(command.gameTitleId)
      _ <- PostgresAchievementWriteOps.ensure(
        catalog.size < PostgresAchievementReadOps.MaximumItems,
        "The achievement catalog has reached its supported size."
      )
      id = UUID.randomUUID()
      _ <- PostgresAchievementWriteOps.create(id, command, context)
      _ <- PostgresSeriesAnalysisMutationOps.enqueueAchievementMutation(List(command.gameTitleId))
      result <- PostgresAchievementReadOps.item(id)
    yield result
  )

  override def update(id: UUID, command: UpdateAchievement, context: AchievementMutationContext)
      : F[Either[AppError, AchievementItem]] =
    write(PostgresAchievementWriteOps.update(id, command, context))

  override def retire(id: UUID, expectedVersion: Long, context: AchievementMutationContext)
      : F[Either[AppError, AchievementItem]] =
    RepositoryResult.capture(PostgresAchievementReadOps.item(id).transact(transactor)).flatMap {
      case Left(error) => error.asLeft[AchievementItem].pure[F]
      case Right(item) if item.rule == AchievementRule.Manual =>
        write(PostgresAchievementRetirementOps.retire(id, expectedVersion, None, context))
      case Right(item) =>
        RepositoryResult.capture(PostgresAchievementRetirementOps.state(
          item.gameTitleId,
          lock = false
        )
          .transact(transactor)).flatMap {
          case Left(error) => error.asLeft[AchievementItem].pure[F]
          case Right(state) => state.current match
              case None =>
                AppError.Conflict("Wait for the first successful calculation before retiring.")
                  .asLeft[AchievementItem].pure[F]
              case Some(artifact) =>
                analysis.retirementItem(item.gameTitleId, artifact, id).flatMap {
                  case Left(error) => error.asLeft[AchievementItem].pure[F]
                  case Right(prepared) => write(PostgresAchievementRetirementOps.retire(
                      id,
                      expectedVersion,
                      Some(prepared),
                      context
                    ))
                }
        }
    }

  override def correctClaim(
      id: UUID,
      command: CorrectAchievementClaim,
      context: AchievementMutationContext
  )
      : F[Either[AppError, AchievementClaim]] =
    write(PostgresAchievementWriteOps.correctClaim(id, command, context))

  override def addToMatch(
      id: MatchId,
      command: AddMatchAchievements,
      context: AchievementMutationContext
  )
      : F[Either[AppError, Unit]] = write(
    for
      matches <- PostgresAchievementMatchLocks.lockMatches(List(id))
      matched <- matches.headOption.toRight(new AppException(AppError.NotFound(
        "match",
        id.value
      ))).liftTo[ConnectionIO]
      _ <- PostgresAchievementWriteOps.ensure(
        matched.version == command.expectedMatchVersion,
        "The match changed. Refresh before recording achievements."
      )
      items <- PostgresAchievementWriteOps.lockForMatch(matched.id, command.achievements)
      changed <-
        PostgresAchievementWriteOps.addDeclarations(matched, command.achievements, items, context)
      _ <- if changed then
        PostgresSeriesAnalysisMutationOps.enqueueAchievementMutation(List(matched.gameTitleId))
      else ().pure[ConnectionIO]
    yield ()
  )
