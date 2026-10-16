package momo.api.bootstrap

import java.time.Instant

import cats.Monad

import momo.api.domain.ids.AccountId
import momo.api.http.modules.{AdminAccountModule, NotificationSettingsModule}
import momo.api.repositories.*
import momo.api.usecases.admin.*

private[bootstrap] object AccountUseCaseWiring:
  def accounts[F[_]: Monad](
      accounts: LoginAccountsRepository[F],
      administration: LoginAccountAdministrationRepository[F],
      members: MembersRepository[F],
      now: F[Instant],
      nextId: F[AccountId],
  ): AdminAccountModule.UseCases[F] = AdminAccountModule.UseCases(
    listLoginAccounts = ListLoginAccounts[F](accounts),
    createLoginAccount = CreateLoginAccount[F](accounts, members, now, nextId),
    updateLoginAccount = UpdateLoginAccount[F](administration, members, now),
  )

  def notifications[F[_]: Monad](
      settings: NotificationSettingsRepository[F],
      now: F[Instant],
  ): NotificationSettingsModule.UseCases[F] = NotificationSettingsModule.UseCases(
    getSettings = GetNotificationSettings[F](settings),
    updateSettings = UpdateNotificationSettings[F](settings, now),
  )
