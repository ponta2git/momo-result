package momo.api.domain

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.usecases.testing.MatchFixtures

final class MatchPolicySpec extends FunSuite:
  private val memberValues = List("a", "b", "c", "d")
  private val allowed = MatchFixtures.allowedMembers(memberValues)

  private val happyInput = MatchPolicy.Input(
    heldEventId = HeldEventId.unsafeFromString("e1"),
    matchNoInEvent = 1,
    gameTitleId = GameTitleId.unsafeFromString("title"),
    seasonMasterId = SeasonMasterId.unsafeFromString("season"),
    ownerMemberId = MemberId.unsafeFromString("a"),
    mapMasterId = MapMasterId.unsafeFromString("map"),
    players = MatchFixtures.defaultPlayerInputs(memberValues),
  )

  test("happy path: produces ValidatedInput"):
    val result = MatchPolicy.validate(happyInput, allowed)
    val v = result.toOption.getOrElse(fail(s"expected Right, got $result"))
    assertEquals(v.players.toList.map(_.memberId.value), List("a", "b", "c", "d"))

  test(
    "multiple errors accumulate (owner not allowed + matchNo invalid + bad players + raw field errors)"
  ):
    val bad = happyInput.copy(
      matchNoInEvent = 0,
      ownerMemberId = MemberId.unsafeFromString("intruder"),
      players = happyInput.players.take(3) :+
        MatchFixtures.playerInput("d", playOrder = 5, rank = 0)
          .copy(incidents = IncidentCounts.Input(-1, 0, 0, 0, 0, 0)),
    )
    val errs = MatchPolicy.validate(bad, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.exists {
      case _: MatchValidationError.MatchNoInEventInvalid => true
      case _ => false
    })
    assert(errs.exists {
      case _: MatchValidationError.OwnerMemberIdNotAllowed => true
      case _ => false
    })
    assert(errs.exists {
      case _: MatchValidationError.PlayOrderInvalid => true
      case _ => false
    })
    assert(errs.exists {
      case _: MatchValidationError.RankInvalid => true
      case _ => false
    })
    assert(errs.exists {
      case _: MatchValidationError.IncidentCountInvalid => true
      case _ => false
    })

  test("toMessage joins domain errors for application boundary"):
    val bad = happyInput
      .copy(matchNoInEvent = 0, ownerMemberId = MemberId.unsafeFromString("intruder"))
    val errors = MatchPolicy.validate(bad, allowed).swap.getOrElse(fail("expected Left"))
    val message = MatchPolicy.toMessage(errors)
    assert(message.contains("matchNoInEvent"))
    assert(message.contains("ownerMemberId"))
end MatchPolicySpec
