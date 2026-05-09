package momo.api.auth

import momo.api.domain.ids.{AccountId, MemberId}

final case class AuthenticatedAccount(
    accountId: AccountId,
    displayName: String,
    isAdmin: Boolean,
    playerMemberId: Option[MemberId],
)
