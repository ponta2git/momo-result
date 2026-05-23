package momo.api.auth

import cats.syntax.all.*

import momo.api.domain.ids.*

final case class MemberRoster(accounts: Map[String, AuthenticatedAccount]):
  def find(accountId: String): Option[AuthenticatedAccount] = accounts.get(accountId)

final case class DevMemberIdentity(
    accountId: AccountId,
    userId: UserId,
    memberId: MemberId,
    displayName: String,
    isAdmin: Boolean,
)

object MemberRoster:
  def devAccountIdFor(memberId: MemberId): Either[String, AccountId] =
    val memberValue = memberId.value
    val accountValue =
      if memberValue.startsWith("member_") then s"account_${memberValue.stripPrefix("member_")}"
      else memberValue
    AccountId.fromString(accountValue).leftMap(error => s"dev account id is invalid: $error")

  def devIdentities(memberIds: List[String]): Either[String, List[DevMemberIdentity]] = memberIds
    .zipWithIndex.traverse { (raw, index) =>
      for
        memberId <- MemberId.fromString(raw)
          .leftMap(error => s"DEV_MEMBER_IDS contains invalid member id: $error")
        userId <- UserId.fromString(memberId.value)
          .leftMap(error => s"DEV_MEMBER_IDS contains invalid user id: $error")
        accountId <- devAccountIdFor(memberId)
      yield DevMemberIdentity(
        accountId = accountId,
        userId = userId,
        memberId = memberId,
        displayName = memberId.value,
        isAdmin = index == 0,
      )
    }

  def devFromMemberIds(memberIds: List[String]): Either[String, MemberRoster] =
    devIdentities(memberIds).map(dev)

  def dev(identities: List[DevMemberIdentity]): MemberRoster = MemberRoster(identities.map {
    identity =>
      identity.accountId.value -> AuthenticatedAccount(
        accountId = identity.accountId,
        displayName = identity.displayName,
        isAdmin = identity.isAdmin,
        playerMemberId = Some(identity.memberId),
      )
  }.toMap)
