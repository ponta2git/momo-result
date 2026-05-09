package momo.api.repositories

import java.time.Instant

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}

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
  def update(id: AccountId, data: UpdateLoginAccountData): F0[Option[LoginAccount]]
  def enabledAdminCount: F0[Int]

trait LoginAccountsRepository[F[_]]:
  def list: F[List[LoginAccount]]
  def find(id: AccountId): F[Option[LoginAccount]]
  def findByDiscordUserId(userId: UserId): F[Option[LoginAccount]]
  def create(account: CreateLoginAccountData): F[LoginAccount]
  def update(id: AccountId, data: UpdateLoginAccountData): F[Option[LoginAccount]]
  def enabledAdminCount: F[Int]

object LoginAccountsRepository:
  def fromConnectionIO[F[_]](
      alg: LoginAccountsAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): LoginAccountsRepository[F] = new LoginAccountsRepository[F]:
    def list: F[List[LoginAccount]] = transactK(alg.list)
    def find(id: AccountId): F[Option[LoginAccount]] = transactK(alg.find(id))
    def findByDiscordUserId(userId: UserId): F[Option[LoginAccount]] =
      transactK(alg.findByDiscordUserId(userId))
    def create(account: CreateLoginAccountData): F[LoginAccount] = transactK(alg.create(account))
    def update(id: AccountId, data: UpdateLoginAccountData): F[Option[LoginAccount]] =
      transactK(alg.update(id, data))
    def enabledAdminCount: F[Int] = transactK(alg.enabledAdminCount)

  def liftIdentity[F[_]](alg: LoginAccountsAlg[F]): LoginAccountsRepository[F] =
    new LoginAccountsRepository[F]:
      export alg.*
end LoginAccountsRepository
