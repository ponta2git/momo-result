package momo.api.auth

import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId}

final case class AuthenticatedAccount(
    accountId: AccountId,
    displayName: String,
    isAdmin: Boolean,
    playerMemberId: Option[MemberId],
)

object AuthenticatedAccount:
  def from(account: LoginAccount): AuthenticatedAccount = AuthenticatedAccount(
    account.id,
    account.displayName,
    account.isAdmin,
    account.playerMemberId,
  )
