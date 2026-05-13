package momo.api.domain

import munit.FunSuite

import momo.api.domain.ids.MemberId

final class FourPlayersSpec extends FunSuite:
  private val allowed = Set(
    MemberId.unsafeFromString("m1"),
    MemberId.unsafeFromString("m2"),
    MemberId.unsafeFromString("m3"),
    MemberId.unsafeFromString("m4"),
    MemberId.unsafeFromString("m5"),
  )

  private val zero = IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0)

  private def player(id: String, playOrder: Int, rank: Int, incidents: IncidentCounts) =
    PlayerResult.unsafeFromInts(
      MemberId.unsafeFromString(id),
      playOrder,
      rank,
      totalAssetsManYen = 100,
      revenueManYen = 50,
      incidents = incidents,
    )

  private def player(id: String, playOrder: Int, rank: Int): PlayerResult =
    player(id, playOrder, rank, zero)

  private val good =
    List(player("m1", 1, 1), player("m2", 2, 2), player("m3", 3, 3), player("m4", 4, 4))

  test("happy path: produces FourPlayers preserving input order"):
    val result = FourPlayers.fromList(good, allowed)
    val fp = result.toOption.getOrElse(fail(s"expected Right, got $result"))
    assertEquals(fp.toList, good)
    assertEquals(fp.byPlayOrder.map(_.memberId.value), List("m1", "m2", "m3", "m4"))
    assertEquals(fp.byRank.map(_.memberId.value), List("m1", "m2", "m3", "m4"))

  test("count mismatch is reported"):
    val result = FourPlayers.fromList(good.take(3), allowed)
    val errs = result.swap.toOption.get.toNonEmptyList.toList
    assert(errs.exists {
      case _: MatchValidationError.PlayerCountMismatch => true
      case _ => false
    })

  test("non-unique memberIds is reported"):
    val players =
      List(player("m1", 1, 1), player("m1", 2, 2), player("m3", 3, 3), player("m4", 4, 4))
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.contains(MatchValidationError.PlayerMemberIdsNotUnique))

  test("non-allowed memberIds reported"):
    val players =
      List(player("intruder", 1, 1), player("m2", 2, 2), player("m3", 3, 3), player("m4", 4, 4))
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.exists {
      case _: MatchValidationError.PlayerMemberIdsNotAllowed => true
      case _ => false
    })

  test("non-permutation playOrder and rank both reported"):
    val players =
      List(player("m1", 1, 1), player("m2", 2, 2), player("m3", 3, 3), player("m4", 3, 3))
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.contains(MatchValidationError.PlayOrdersNotPermutation))
    assert(errs.contains(MatchValidationError.RanksNotPermutation))

  test("multiple unrelated errors accumulate in a single chain"):
    val players =
      List(player("m1", 1, 1), player("m1", 2, 2), player("m3", 3, 3), player("m4", 4, 3))
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.contains(MatchValidationError.PlayerMemberIdsNotUnique))
    assert(errs.contains(MatchValidationError.RanksNotPermutation))
