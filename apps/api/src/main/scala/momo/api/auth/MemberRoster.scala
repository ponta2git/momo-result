package momo.api.auth

import momo.api.domain.ids.*

final case class MemberRoster(accounts: Map[String, AuthenticatedAccount]):
  def find(accountId: String): Option[AuthenticatedAccount] = accounts.get(accountId)

object MemberRoster:
  def devAccountIdFor(memberId: String): AccountId =
    if memberId.startsWith("member_") then AccountId(s"account_${memberId.stripPrefix("member_")}")
    else AccountId(memberId)

  def dev(memberIds: List[String]): MemberRoster = MemberRoster(memberIds.zipWithIndex.map {
    (id, index) =>
      val accountId = devAccountIdFor(id)
      accountId.value -> AuthenticatedAccount(
        accountId = accountId,
        displayName = id,
        isAdmin = index == 0,
        playerMemberId = Some(MemberId(id)),
      )
  }.toMap)
