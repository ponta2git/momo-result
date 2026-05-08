package momo.api.usecases

import munit.FunSuite

import momo.api.domain.MatchValidationError
import momo.api.domain.ids.*
import momo.api.usecases.testing.MatchFixtures

final class MatchValidationSpec extends FunSuite:
  private val memberValues = List("a", "b", "c", "d")
  private val allowed = MatchFixtures.allowedMembers(memberValues)

  private val happyInput = MatchValidation.Input(
    heldEventId = HeldEventId("e1"),
    matchNoInEvent = 1,
    gameTitleId = GameTitleId("title"),
    seasonMasterId = SeasonMasterId("season"),
    ownerMemberId = MemberId("a"),
    mapMasterId = MapMasterId("map"),
    players = MatchFixtures.defaultPlayers(memberValues),
  )

  test("happy path: produces ValidatedInput"):
    val result = MatchValidation.validate(happyInput, allowed)
    val v = result.toOption.getOrElse(fail(s"expected Right, got $result"))
    assertEquals(v.players.toList.map(_.memberId.value), List("a", "b", "c", "d"))

  test("multiple errors accumulate (owner not allowed + matchNo invalid + bad players)"):
    val bad = happyInput.copy(
      matchNoInEvent = 0,
      ownerMemberId = MemberId("intruder"),
      players = happyInput.players.take(3),
    )
    val errs = MatchValidation.validate(bad, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.exists {
      case _: MatchValidationError.MatchNoInEventInvalid => true
      case _ => false
    })
    assert(errs.exists {
      case _: MatchValidationError.OwnerMemberIdNotAllowed => true
      case _ => false
    })
    assert(errs.exists {
      case _: MatchValidationError.PlayerCountMismatch => true
      case _ => false
    })

  test("validateShape shim returns AppError.ValidationFailed joining all messages"):
    val bad = happyInput.copy(matchNoInEvent = 0, ownerMemberId = MemberId("intruder"))
    val result = MatchValidation.validateShape(bad, allowed)
    val err = result.swap.getOrElse(fail("expected Left"))
    assert(
      err match
        case _: momo.api.errors.AppError.ValidationFailed => true
        case _ => false
    )
end MatchValidationSpec
