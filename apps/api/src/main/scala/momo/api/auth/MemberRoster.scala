package momo.api.auth

import momo.api.domain.ids.*

final case class MemberRoster(members: Map[String, AuthenticatedMember]):
  def find(memberId: String): Option[AuthenticatedMember] =
    members.get(memberId)

object MemberRoster:
  def dev(memberIds: List[String]): MemberRoster =
    MemberRoster(
      memberIds.map(id => id -> AuthenticatedMember(MemberId(id), id)).toMap
    )
