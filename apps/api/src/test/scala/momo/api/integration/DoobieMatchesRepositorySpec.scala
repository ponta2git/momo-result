package momo.api.integration

import cats.effect.IO
import java.time.Instant
import momo.api.domain.*
import momo.api.repositories.doobie.*

final class DoobieMatchesRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-04-30T00:00:00Z")
  private val gameTitleId = "title_world"
  private val mapMasterId = "map_east"
  private val seasonMasterId = "season_2024_spring"
  private val heldEventId = "held_2026_04_30"

  private def gameTitles = new DoobieGameTitlesRepository[IO](xa)
  private def mapMasters = new DoobieMapMastersRepository[IO](xa)
  private def seasonMasters = new DoobieSeasonMastersRepository[IO](xa)
  private def heldEvents = new DoobieHeldEventsRepository[IO](xa)
  private def matches = new DoobieMatchesRepository[IO](xa)

  /** Insert a complete prerequisite graph: game/map/season/held_event. */
  private def seedPrereqs: IO[Unit] =
    for
      _ <- gameTitles.create(GameTitle(gameTitleId, "桃太郎電鉄ワールド", "world", 1, now))
      _ <- mapMasters.create(MapMaster(mapMasterId, gameTitleId, "東日本編", 1, now))
      _ <- seasonMasters.create(SeasonMaster(seasonMasterId, gameTitleId, "2024-spring", 1, now))
      _ <- heldEvents.create(HeldEvent(heldEventId, now))
    yield ()

  private def player(
      memberId: String,
      playOrder: Int,
      rank: Int,
      totalAssets: Int,
      revenue: Int,
  ): PlayerResult = playerWithIncidents(
    memberId = memberId,
    playOrder = playOrder,
    rank = rank,
    totalAssets = totalAssets,
    revenue = revenue,
    destination = 0,
    plusStation = 0,
  )

  private def playerWithIncidents(
      memberId: String,
      playOrder: Int,
      rank: Int,
      totalAssets: Int,
      revenue: Int,
      destination: Int,
      plusStation: Int,
  ): PlayerResult = PlayerResult(
    memberId = memberId,
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = totalAssets,
    revenueManYen = revenue,
    incidents = IncidentCounts(
      destination = destination,
      plusStation = plusStation,
      minusStation = 0,
      cardStation = 0,
      cardShop = 0,
      suriNoGinji = 0,
    ),
  )

  private def sampleMatch(id: String, matchNo: Int): MatchRecord = MatchRecord(
    id = id,
    heldEventId = heldEventId,
    matchNoInEvent = matchNo,
    gameTitleId = gameTitleId,
    layoutFamily = "world",
    seasonMasterId = seasonMasterId,
    ownerMemberId = "member_ponta",
    mapMasterId = mapMasterId,
    playedAt = now,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = List(
      playerWithIncidents("member_ponta", 1, 1, 12000, 3000, destination = 5, plusStation = 2),
      player("member_akane_mami", 2, 2, 9000, 1500),
      player("member_otaka", 3, 3, 6500, 800),
      player("member_eu", 4, 4, 4000, 200),
    ),
    createdByMemberId = "member_ponta",
    createdAt = now,
  )

  test("create persists matches + 4 players + 24 incident rows atomically"):
    val rec = sampleMatch("match_001", 1)
    for
      _ <- seedPrereqs
      _ <- matches.create(rec)
      found <- matches.find("match_001")
    yield
      val got = found.getOrElse(fail("match_001 not found after create"))
      assertEquals(got.id, rec.id)
      assertEquals(got.players.size, 4)
      assertEquals(got.players.map(_.playOrder), List(1, 2, 3, 4))
      assertEquals(got.players.map(_.rank), List(1, 2, 3, 4))
      val ponta = got.players.find(_.memberId == "member_ponta").get
      assertEquals(ponta.totalAssetsManYen, 12000)
      assertEquals(ponta.incidents.destination, 5)
      assertEquals(ponta.incidents.plusStation, 2)
      assertEquals(ponta.incidents.suriNoGinji, 0)

  test("listByHeldEvent orders by match_no_in_event"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_b", 2))
      _ <- matches.create(sampleMatch("match_a", 1))
      list <- matches.listByHeldEvent(heldEventId)
    yield
      assertEquals(list.map(_.id), List("match_a", "match_b"))
      assertEquals(list.map(_.matchNoInEvent), List(1, 2))

  test("existsMatchNo and maxMatchNo reflect inserted rows"):
    for
      _ <- seedPrereqs
      empty <- matches.existsMatchNo(heldEventId, 1)
      m0 <- matches.maxMatchNo(heldEventId)
      _ <- matches.create(sampleMatch("match_001", 1))
      _ <- matches.create(sampleMatch("match_003", 3))
      ex1 <- matches.existsMatchNo(heldEventId, 1)
      ex2 <- matches.existsMatchNo(heldEventId, 2)
      mn <- matches.maxMatchNo(heldEventId)
    yield
      assertEquals(empty, false)
      assertEquals(m0, 0)
      assertEquals(ex1, true)
      assertEquals(ex2, false)
      assertEquals(mn, 3)

  test("countByHeldEvents returns zero for unknown event ids"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_001", 1))
      _ <- matches.create(sampleMatch("match_002", 2))
      counts <- matches.countByHeldEvents(List(heldEventId, "missing_event"))
    yield
      assertEquals(counts.get(heldEventId), Some(2))
      assertEquals(counts.get("missing_event"), Some(0))

  test("countByHeldEvents short-circuits on empty input"):
    matches.countByHeldEvents(Nil).map(m => assertEquals(m, Map.empty[String, Int]))

  test("duplicate match_no_in_event for same held_event raises"):
    val rec1 = sampleMatch("match_001", 1)
    val rec2 = sampleMatch("match_002", 1)
    val program =
      for
        _ <- seedPrereqs
        _ <- matches.create(rec1)
        e <- matches.create(rec2).attempt
      yield e
    program
      .map(result => assert(result.isLeft, s"expected duplicate match_no to fail, got $result"))
end DoobieMatchesRepositorySpec
