package momo.api.usecases

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{IncidentCounts, MatchValidationError, PlayerResult}

final class MatchValidationSpec extends FunSuite:
  private val zero = IncidentCounts(0, 0, 0, 0, 0, 0)

  private val allowed = Set(MemberId("a"), MemberId("b"), MemberId("c"), MemberId("d"))

  private def player(id: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult(
    memberId = MemberId(id),
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = 100,
    revenueManYen = 50,
    incidents = zero,
  )

  private val happyInput = MatchValidation.Input(
    heldEventId = HeldEventId("e1"),
    matchNoInEvent = 1,
    gameTitleId = GameTitleId("title"),
    seasonMasterId = SeasonMasterId("season"),
    ownerMemberId = MemberId("a"),
    mapMasterId = MapMasterId("map"),
    players = List(player("a", 1, 1), player("b", 2, 2), player("c", 3, 3), player("d", 4, 4)),
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
