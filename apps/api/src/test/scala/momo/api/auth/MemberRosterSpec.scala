package momo.api.auth

import munit.FunSuite

final class MemberRosterSpec extends FunSuite:
  test("dev identities derive account ids and administrator order from member ids"):
    val identities = MemberRoster
      .devIdentities(List("member_ponta", "member_akane_mami"))
      .fold(error => fail(error), identity)
    val roster = MemberRoster.dev(identities)

    assertEquals(identities.map(_.accountId.value), List("account_ponta", "account_akane_mami"))
    assertEquals(identities.map(_.userId.value), List("member_ponta", "member_akane_mami"))
    assertEquals(roster.find("account_ponta").map(_.isAdmin), Some(true))
    assertEquals(roster.find("account_akane_mami").map(_.isAdmin), Some(false))
    assertEquals(roster.find("account_ponta").flatMap(_.playerMemberId.map(_.value)), Some(
      "member_ponta"
    ))

  test("dev identities reject invalid member ids at the bootstrap boundary"):
    val result = MemberRoster.devIdentities(List("member_ponta", " "))

    assert(result.left.exists(_.contains("DEV_MEMBER_IDS contains invalid member id")))
end MemberRosterSpec
