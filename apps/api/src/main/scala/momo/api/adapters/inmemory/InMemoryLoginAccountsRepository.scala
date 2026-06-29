package momo.api.adapters.inmemory

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.*

final class InMemoryLoginAccountsRepository[F[_]: Sync] private (
    ref: Ref[F, Map[AccountId, LoginAccount]]
) extends LoginAccountsRepository[F]:
  override def list: F[List[LoginAccount]] = ref.get
    .map(_.values.toList.sortBy(a => (!a.isAdmin, !a.loginEnabled, a.createdAt, a.id.value)))
  override def find(id: AccountId): F[Option[LoginAccount]] = ref.get.map(_.get(id))
  override def findByDiscordUserId(userId: UserId): F[Option[LoginAccount]] = ref.get
    .map(_.values.find(_.discordUserId == userId))
  override def create(account: CreateLoginAccountData): F[LoginAccount] =
    val created = LoginAccount(
      account.id,
      account.discordUserId,
      account.displayName,
      account.playerMemberId,
      account.loginEnabled,
      account.isAdmin,
      account.createdAt,
      account.updatedAt,
    )
    ref.modify { accounts =>
      if accounts.contains(created.id) ||
        accounts.values.exists(_.discordUserId == created.discordUserId)
      then
        (
          accounts,
          Left(masterConflict(s"login account already exists for discord user ${created
              .discordUserId.value}.")),
        )
      else (accounts.updated(created.id, created), Right(created))
    }.flatMap(complete)
  override def update(id: AccountId, data: UpdateLoginAccountData): F[Option[LoginAccount]] = ref
    .modify { accounts =>
      accounts.get(id) match
        case None => (accounts, None)
        case Some(existing) =>
          val updated = existing.copy(
            displayName = data.displayName.getOrElse(existing.displayName),
            playerMemberId = data.playerMemberId.getOrElse(existing.playerMemberId),
            loginEnabled = data.loginEnabled.getOrElse(existing.loginEnabled),
            isAdmin = data.isAdmin.getOrElse(existing.isAdmin),
            updatedAt = data.updatedAt,
          )
          val wouldRemoveLastAdmin = existing.loginEnabled && existing.isAdmin &&
            (!updated.loginEnabled || !updated.isAdmin) &&
            accounts.values.count(a => a.loginEnabled && a.isAdmin) <= 1
          if wouldRemoveLastAdmin then (accounts, None)
          else (accounts.updated(id, updated), Some(updated))
    }
  override def enabledAdminCount: F[Int] = ref.get
    .map(_.values.count(a => a.loginEnabled && a.isAdmin))

final class InMemoryLoginAccountAdministrationRepository[F[_]: Sync](
    accounts: LoginAccountsRepository[F],
    sessions: AppSessionsRepository[F],
) extends LoginAccountAdministrationRepository[F]:
  override def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult] =
    for
      existing <- accounts.find(id)
      result <- existing match
        case None => Sync[F].pure(LoginAccountAdministrationUpdateResult.NotFound)
        case Some(account) => updateExisting(account, data)
    yield result

  private def updateExisting(
      existing: LoginAccount,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult] = accounts.update(existing.id, data).flatMap {
    case Some(updated) =>
      val revokeSessions = existing.loginEnabled && !updated.loginEnabled
      val revoke =
        if revokeSessions then sessions.deleteByAccount(existing.id).void else Sync[F].unit
      revoke.as(LoginAccountAdministrationUpdateResult.Updated(updated))
    case None if wouldRemoveEnabledAdmin(existing, data) =>
      Sync[F].pure(LoginAccountAdministrationUpdateResult.LastEnabledAdmin)
    case None => Sync[F].pure(LoginAccountAdministrationUpdateResult.NotFound)
  }

  private def wouldRemoveEnabledAdmin(
      existing: LoginAccount,
      data: UpdateLoginAccountData,
  ): Boolean =
    val nextLoginEnabled = data.loginEnabled.getOrElse(existing.loginEnabled)
    val nextIsAdmin = data.isAdmin.getOrElse(existing.isAdmin)
    existing.loginEnabled && existing.isAdmin && (!nextLoginEnabled || !nextIsAdmin)

object InMemoryLoginAccountsRepository:
  def create[F[_]: Sync](accounts: List[LoginAccount]): F[InMemoryLoginAccountsRepository[F]] = Ref
    .of[F, Map[AccountId, LoginAccount]](accounts.map(a => a.id -> a).toMap)
    .map(new InMemoryLoginAccountsRepository(_))
