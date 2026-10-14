package momo.api.adapters.inmemory

import cats.effect.std.Mutex
import cats.effect.{Async, Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.*

final class InMemoryLoginAccountsRepository[F[_]: Sync] private (
    ref: Ref[F, Map[AccountId, LoginAccount]],
    lifecycle: Mutex[F],
) extends LoginAccountsRepository[F]:
  override def list: F[List[LoginAccount]] = ref.get
    .map(_.values.toList.sortBy { account =>
      val roleOrder = account.role match
        case AccountRole.Admin => 0
        case AccountRole.Operator => 1
        case AccountRole.User => 2
      (roleOrder, !account.loginEnabled, account.createdAt, account.id.value)
    })
  override def find(id: AccountId): F[Option[LoginAccount]] = ref.get.map(_.get(id))
  override def findByDiscordUserId(userId: UserId): F[Option[LoginAccount]] = ref.get
    .map(_.values.find(_.discordUserId == userId))
  override def create(account: CreateLoginAccountData): F[Either[AppError, LoginAccount]] =
    val created = LoginAccount(
      account.id,
      account.discordUserId,
      account.displayName,
      account.playerMemberId,
      account.loginEnabled,
      account.role,
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
    }

  private[inmemory] def withLifecycleLock[A](operation: F[A]): F[A] =
    lifecycle.lock.surround(Sync[F].uncancelable(_ => operation))

  private[inmemory] def updateUnchecked(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): F[(LoginAccountAdministrationUpdateResult, Boolean)] = ref
    .modify { accounts =>
      accounts.get(id) match
        case None => (accounts, (LoginAccountAdministrationUpdateResult.NotFound, false))
        case Some(existing) =>
          val updated = existing.copy(
            displayName = data.displayName.getOrElse(existing.displayName),
            playerMemberId = data.playerMemberId.getOrElse(existing.playerMemberId),
            loginEnabled = data.loginEnabled.getOrElse(existing.loginEnabled),
            role = data.role.getOrElse(existing.role),
            updatedAt = data.updatedAt,
          )
          val wouldRemoveLastAdmin = existing.loginEnabled && existing.role == AccountRole.Admin &&
            (!updated.loginEnabled || updated.role != AccountRole.Admin) &&
            accounts.values.count(a => a.loginEnabled && a.role == AccountRole.Admin) <= 1
          if wouldRemoveLastAdmin then
            (accounts, (LoginAccountAdministrationUpdateResult.LastEnabledAdmin, false))
          else
            val revokeSessions = existing.loginEnabled && !updated.loginEnabled
            (
              accounts.updated(id, updated),
              (LoginAccountAdministrationUpdateResult.Updated(updated), revokeSessions),
            )
    }
final class InMemoryLoginAccountAdministrationRepository[F[_]: Sync](
    accounts: InMemoryLoginAccountsRepository[F],
    sessions: AppSessionsRepository[F],
) extends LoginAccountAdministrationRepository[F], LoginSessionCreationRepository[F]:
  override def createIfAccountCurrent(
      session: AppSession,
      expectedAccountUpdatedAt: java.time.Instant,
  ): F[Boolean] = accounts.withLifecycleLock(accounts.find(session.accountId).flatMap {
    case Some(current)
        if current.loginEnabled && current.updatedAt.equals(expectedAccountUpdatedAt) =>
      sessions.upsert(session).as(true)
    case _ => false.pure[F]
  })

  override def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult] = accounts.withLifecycleLock(
    accounts.updateUnchecked(id, data).flatMap { case (result, revokeSessions) =>
      if revokeSessions then sessions.deleteByAccount(id).as(result)
      else Sync[F].pure(result)
    }
  )

object InMemoryLoginAccountsRepository:
  def create[F[_]: Async](accounts: List[LoginAccount]): F[InMemoryLoginAccountsRepository[F]] =
    (Ref.of[F, Map[AccountId, LoginAccount]](accounts.map(a => a.id -> a).toMap), Mutex[F])
      .mapN(new InMemoryLoginAccountsRepository(_, _))
