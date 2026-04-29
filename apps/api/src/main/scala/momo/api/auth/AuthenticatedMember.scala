package momo.api.auth

import momo.api.domain.ids.MemberId

final case class AuthenticatedMember(memberId: MemberId, displayName: String)
