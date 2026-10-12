package momo.api.auth

import momo.api.domain.ids.{AccountId, MemberId}
import momo.api.domain.{AccountRole, LoginAccount}

final case class AuthenticatedAccount(
    accountId: AccountId,
    displayName: String,
    role: AccountRole,
    playerMemberId: Option[MemberId],
)

object AuthenticatedAccount:
  def from(account: LoginAccount): AuthenticatedAccount = AuthenticatedAccount(
    account.id,
    account.displayName,
    account.role,
    account.playerMemberId,
  )
