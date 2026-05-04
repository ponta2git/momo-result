package momo.api.domain

import munit.FunSuite

import momo.api.domain.ids.MemberId

final class FourPlayersSpec extends FunSuite:
  private val allowed = Set(
    MemberId("m1"),
    MemberId("m2"),
    MemberId("m3"),
    MemberId("m4"),
    MemberId("m5"),
  )

  private val zero = IncidentCounts(0, 0, 0, 0, 0, 0)

  private def player(
      id: String,
      playOrder: Int,
      rank: Int,
      incidents: IncidentCounts,
  ) = PlayerResult(MemberId(id), playOrder, rank, totalAssetsManYen = 100, revenueManYen = 50,
    incidents = incidents)

  private def player(id: String, playOrder: Int, rank: Int): PlayerResult =
    player(id, playOrder, rank, zero)

  private val good = List(
    player("m1", 1, 1),
    player("m2", 2, 2),
    player("m3", 3, 3),
    player("m4", 4, 4),
  )

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
    val players = List(
      player("m1", 1, 1),
      player("m1", 2, 2),
      player("m3", 3, 3),
      player("m4", 4, 4),
    )
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.contains(MatchValidationError.PlayerMemberIdsNotUnique))

  test("non-allowed memberIds reported"):
    val players = List(
      player("intruder", 1, 1),
      player("m2", 2, 2),
      player("m3", 3, 3),
      player("m4", 4, 4),
    )
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.exists {
      case _: MatchValidationError.PlayerMemberIdsNotAllowed => true
      case _ => false
    })

  test("non-permutation playOrder and rank both reported"):
    val players = List(
      player("m1", 1, 1),
      player("m2", 2, 2),
      player("m3", 3, 3),
      player("m4", 5, 5),
    )
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.contains(MatchValidationError.PlayOrdersNotPermutation))
    assert(errs.contains(MatchValidationError.RanksNotPermutation))

  test("negative incident counts accumulated per offending player"):
    val players = List(
      player("m1", 1, 1, IncidentCounts(-1, 0, 0, 0, 0, 0)),
      player("m2", 2, 2, IncidentCounts(0, -1, 0, 0, 0, 0)),
      player("m3", 3, 3),
      player("m4", 4, 4),
    )
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    val negs = errs.collect { case e: MatchValidationError.IncidentCountsNegative => e }
    assertEquals(negs.size, 2)
    assertEquals(negs.map(_.memberId.value).toSet, Set("m1", "m2"))

  test("multiple unrelated errors accumulate in a single chain"):
    val players = List(
      player("m1", 1, 1),
      player("m1", 2, 2),
      player("m3", 3, 5),
      player("m4", 4, 4, IncidentCounts(-1, 0, 0, 0, 0, 0)),
    )
    val errs = FourPlayers.fromList(players, allowed).swap.toOption.get.toNonEmptyList.toList
    assert(errs.contains(MatchValidationError.PlayerMemberIdsNotUnique))
    assert(errs.contains(MatchValidationError.RanksNotPermutation))
    assert(errs.exists {
      case _: MatchValidationError.IncidentCountsNegative => true
      case _ => false
    })
