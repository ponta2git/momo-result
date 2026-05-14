package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.postgres.*

final class PostgresMatchesRepositorySpec extends IntegrationSuite:

  private val now = Instant.parse("2026-04-30T00:00:00Z")
  private val gameTitleId = GameTitleId.unsafeFromString("title_world")
  private val mapMasterId = MapMasterId.unsafeFromString("map_east")
  private val seasonMasterId = SeasonMasterId.unsafeFromString("season_2024_spring")
  private val heldEventId = HeldEventId.unsafeFromString("held_2026_04_30")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def heldEvents = new PostgresHeldEventsRepository[IO](transactor)
  private def matches = new PostgresMatchesRepository[IO](transactor)
  private def confirmations = new PostgresMatchConfirmationRepository[IO](transactor)

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
  ): PlayerResult = PlayerResult.unsafeFromInts(
    memberId = MemberId.unsafeFromString(memberId),
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = totalAssets,
    revenueManYen = revenue,
    incidents = IncidentCounts.unsafeFromInts(
      destination = destination,
      plusStation = plusStation,
      minusStation = 0,
      cardStation = 0,
      cardShop = 0,
      suriNoGinji = 0,
    ),
  )

  private def sampleMatch(id: String, matchNo: Int): MatchRecord = MatchRecord(
    id = MatchId.unsafeFromString(id),
    heldEventId = heldEventId,
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNo),
    gameTitleId = gameTitleId,
    layoutFamily = "world",
    seasonMasterId = seasonMasterId,
    ownerMemberId = MemberId.unsafeFromString("member_ponta"),
    mapMasterId = mapMasterId,
    playedAt = now,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      playerWithIncidents("member_ponta", 1, 1, 12000, 3000, destination = 5, plusStation = 2),
      player("member_akane_mami", 2, 2, 9000, 1500),
      player("member_otaka", 3, 3, 6500, 800),
      player("member_eu", 4, 4, 4000, 200),
    ),
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    createdAt = now,
  )

  test("create persists matches + 4 players + 24 incident rows atomically"):
    val rec = sampleMatch("match_001", 1)
    for
      _ <- seedPrereqs
      _ <- matches.create(rec)
      found <- matches.find(MatchId.unsafeFromString("match_001"))
    yield
      val got = found.getOrElse(fail("match_001 not found after create"))
      assertEquals(got.id, rec.id)
      assertEquals(got.players.toList.size, 4)
      assertEquals(got.players.byPlayOrder.map(_.playOrder.value), List(1, 2, 3, 4))
      assertEquals(got.players.byRank.map(_.rank.value), List(1, 2, 3, 4))
      val ponta = got.players.toList.find(_.memberId == MemberId.unsafeFromString("member_ponta"))
        .get
      assertEquals(ponta.totalAssetsManYen.value, 12000)
      assertEquals(ponta.incidents.destination.value, 5)
      assertEquals(ponta.incidents.plusStation.value, 2)
      assertEquals(ponta.incidents.suriNoGinji.value, 0)

  test("listByHeldEvent orders by match_no_in_event"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_b", 2))
      _ <- matches.create(sampleMatch("match_a", 1))
      list <- matches.listByHeldEvent(heldEventId)
    yield
      assertEquals(list.map(_.id.value), List("match_a", "match_b"))
      assertEquals(list.map(_.matchNoInEvent.value), List(1, 2))

  test("existsMatchNo and maxMatchNo reflect inserted rows"):
    for
      _ <- seedPrereqs
      empty <- matches.existsMatchNo(heldEventId, MatchNoInEvent.unsafeFromInt(1))
      m0 <- matches.maxMatchNo(heldEventId)
      _ <- matches.create(sampleMatch("match_001", 1))
      _ <- matches.create(sampleMatch("match_003", 3))
      ex1 <- matches.existsMatchNo(heldEventId, MatchNoInEvent.unsafeFromInt(1))
      ex2 <- matches.existsMatchNo(heldEventId, MatchNoInEvent.unsafeFromInt(2))
      mn <- matches.maxMatchNo(heldEventId)
    yield
      assertEquals(empty, false)
      assertEquals(m0, 0)
      assertEquals(ex1, true)
      assertEquals(ex2, false)
      assertEquals(mn, 3)

  test("update changes parent fields and replaces child player rows without deleting the match"):
    val rec = sampleMatch("match_001", 1)
    val updated = rec.copy(
      matchNoInEvent = MatchNoInEvent.unsafeFromInt(2),
      players = FourPlayers(
        playerWithIncidents("member_ponta", 1, 4, 1000, 100, destination = 0, plusStation = 0),
        player("member_akane_mami", 2, 3, 2000, 200),
        player("member_otaka", 3, 2, 3000, 300),
        player("member_eu", 4, 1, 4000, 400),
      ),
    )
    for
      _ <- seedPrereqs
      _ <- matches.create(rec)
      _ <- matches.update(updated, now.plusSeconds(60))
      found <- matches.find(rec.id)
    yield
      val got = found.getOrElse(fail("match_001 not found after update"))
      assertEquals(got.id, rec.id)
      assertEquals(got.createdAt, rec.createdAt)
      assertEquals(got.matchNoInEvent.value, 2)
      assertEquals(
        got.players.byRank.map(_.memberId.value),
        List("member_eu", "member_otaka", "member_akane_mami", "member_ponta"),
      )
      val ponta = got.players.toList.find(_.memberId == MemberId.unsafeFromString("member_ponta"))
        .get
      assertEquals(ponta.totalAssetsManYen.value, 1000)
      assertEquals(ponta.incidents.destination.value, 0)

  test("update maps concurrently missing match to NotFound"):
    val rec = sampleMatch("match_missing_update", 1)
    for
      _ <- seedPrereqs
      result <- matches.update(rec, now.plusSeconds(60)).attempt
    yield result match
      case Left(error: AppException) =>
        assertEquals(error.error, AppError.NotFound("match", rec.id.value))
      case other => fail(s"expected AppException(NotFound), got $other")

  test("countByHeldEvents returns zero for unknown event ids"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_001", 1))
      _ <- matches.create(sampleMatch("match_002", 2))
      counts <- matches
        .countByHeldEvents(List(heldEventId, HeldEventId.unsafeFromString("missing_event")))
    yield
      assertEquals(counts.get(heldEventId), Some(2))
      assertEquals(counts.get(HeldEventId.unsafeFromString("missing_event")), Some(0))

  test("countByHeldEvents short-circuits on empty input"):
    matches.countByHeldEvents(Nil).map(m => assertEquals(m, Map.empty[HeldEventId, Int]))

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

  test("confirmation maps duplicate match_no_in_event to Conflict"):
    val rec1 = sampleMatch("match_confirm_001", 1)
    val rec2 = sampleMatch("match_confirm_002", 1)
    for
      _ <- seedPrereqs
      inserted <- confirmations.confirm(rec1, None, now)
      result <- confirmations.confirm(rec2, None, now).attempt
    yield
      assertEquals(inserted, true)
      result match
        case Left(error: AppException) => error.error match
            case _: AppError.Conflict => ()
            case other => fail(s"expected Conflict, got $other")
        case other => fail(s"expected AppException(Conflict), got $other")
end PostgresMatchesRepositorySpec
