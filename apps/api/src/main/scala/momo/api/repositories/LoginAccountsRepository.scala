package momo.api.repositories

import java.time.Instant

import cats.{~>, MonadThrow}

import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.errors.AppError

final case class CreateLoginAccountData(
    id: AccountId,
    discordUserId: UserId,
    displayName: String,
    playerMemberId: Option[MemberId],
    loginEnabled: Boolean,
    isAdmin: Boolean,
    createdAt: Instant,
    updatedAt: Instant,
)

final case class UpdateLoginAccountData(
    displayName: Option[String],
    playerMemberId: Option[Option[MemberId]],
    loginEnabled: Option[Boolean],
    isAdmin: Option[Boolean],
    updatedAt: Instant,
)

trait LoginAccountsAlg[F0[_]]:
  def list: F0[List[LoginAccount]]
  def find(id: AccountId): F0[Option[LoginAccount]]
  def findByDiscordUserId(userId: UserId): F0[Option[LoginAccount]]
  def create(account: CreateLoginAccountData): F0[LoginAccount]

/** Usecase-facing facade: expected create rejections are values; unexpected failures remain in F. */
trait LoginAccountsRepository[F[_]]:
  def list: F[List[LoginAccount]]
  def find(id: AccountId): F[Option[LoginAccount]]
  def findByDiscordUserId(userId: UserId): F[Option[LoginAccount]]
  def create(account: CreateLoginAccountData): F[Either[AppError, LoginAccount]]

enum LoginAccountAdministrationUpdateResult derives CanEqual:
  case Updated(account: LoginAccount)
  case NotFound
  case LastEnabledAdmin

trait LoginAccountAdministrationRepository[F[_]]:
  def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult]

object LoginAccountsRepository:
  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: LoginAccountsAlg[F0],
      liftK: F0 ~> F,
  ): LoginAccountsRepository[F] =
    new LoginAccountsRepository[F]:
      def list: F[List[LoginAccount]] = liftK(alg.list)
      def find(id: AccountId): F[Option[LoginAccount]] = liftK(alg.find(id))
      def findByDiscordUserId(userId: UserId): F[Option[LoginAccount]] =
        liftK(alg.findByDiscordUserId(userId))
      def create(account: CreateLoginAccountData): F[Either[AppError, LoginAccount]] =
        RepositoryResult.capture(liftK(alg.create(account)))

end LoginAccountsRepository
