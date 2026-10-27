package momo.api.integration

import java.time.{Instant, LocalDate}

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.*
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*

final class PostgresHeldEventListReadModelSpec extends IntegrationSuite:

  private val worldId = GameTitleId.unsafeFromString("title_world")
  private val eastId = MapMasterId.unsafeFromString("map_east")
  private val westId = MapMasterId.unsafeFromString("map_west")
  private val springId = SeasonMasterId.unsafeFromString("season_2024_spring")
  private val secondTitleId = GameTitleId.unsafeFromString("title_second")
  private val secondMapId = MapMasterId.unsafeFromString("map_second")
  private val secondSeasonId = SeasonMasterId.unsafeFromString("season_second")
  private val baseTime = Instant.parse("2026-04-29T03:00:00Z")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def heldEvents = new PostgresHeldEventsRepository[IO](transactor)
  private def confirmations = new PostgresMatchConfirmationRepository[IO](transactor)
  private def reader = new PostgresHeldEventListReadModel[IO](transactor)

  private def seedMasters: IO[Unit] =
    for
      _ <- gameTitles
        .createWithNextDisplayOrder(GameTitle(worldId, "桃太郎電鉄ワールド", "world", 1, baseTime))
      _ <- gameTitles
        .createWithNextDisplayOrder(GameTitle(secondTitleId, "桃太郎電鉄2", "world", 2, baseTime))
      _ <- mapMasters.createWithNextDisplayOrder(MapMaster(eastId, worldId, "東日本編", 1, baseTime))
      _ <- mapMasters.createWithNextDisplayOrder(MapMaster(westId, worldId, "西日本編", 2, baseTime))
      _ <- mapMasters
        .createWithNextDisplayOrder(MapMaster(secondMapId, secondTitleId, "全国編", 1, baseTime))
      _ <- seasonMasters
        .createWithNextDisplayOrder(SeasonMaster(springId, worldId, "2024-spring", 1, baseTime))
      _ <- seasonMasters
        .createWithNextDisplayOrder(SeasonMaster(secondSeasonId, secondTitleId, "第2期", 1, baseTime))
    yield ()

  private def event(id: String, startAt: Instant): IO[HeldEventId] =
    val heldEventId = HeldEventId.unsafeFromString(id)
    heldEvents.create(HeldEvent(heldEventId, startAt)).as(heldEventId)

  private def player(memberId: String, playOrder: Int, rank: Int): PlayerResult = PlayerResult
    .unsafeFromInts(
      memberId = MemberId.unsafeFromString(memberId),
      playOrder = playOrder,
      rank = rank,
      totalAssetsManYen = 10_000 - (rank * 1_000),
      revenueManYen = 1_000 - (rank * 100),
      incidents = IncidentCounts.unsafeFromInts(0, 0, 0, 0, 0, 0),
    )

  /** Ranks are given in member order: ponta, akane_mami, otaka, eu. */
  private def confirm(
      id: String,
      heldEventId: HeldEventId,
      matchNo: Int,
      ranks: (Int, Int, Int, Int),
  ): MatchRecord = MatchRecord(
    id = MatchId.unsafeFromString(id),
    heldEventId = heldEventId,
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNo),
    gameTitleId = worldId,
    layoutFamily = "world",
    seasonMasterId = springId,
    ownerMemberId = MemberId.unsafeFromString("member_ponta"),
    mapMasterId = eastId,
    playedAt = baseTime,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      player("member_ponta", 1, ranks._1),
      player("member_akane_mami", 2, ranks._2),
      player("member_otaka", 3, ranks._3),
      player("member_eu", 4, ranks._4),
    ),
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    createdAt = baseTime,
  )

  private def plain(id: String, heldEventId: HeldEventId, matchNo: Int): MatchRecord =
    confirm(id, heldEventId, matchNo, (1, 2, 3, 4))

  private def withNote(record: MatchRecord, body: String): MatchRecord = record.copy(note =
    MatchNote(
      Some(MatchNoteBody.fromRequiredString(body).getOrElse(fail("invalid note fixture"))),
      MatchNoteVersion.Initial.next,
      Some(AccountId.unsafeFromString("account_ponta")),
      Some(record.createdAt),
    )
  )

  private def create(record: MatchRecord): IO[Unit] = confirmations
    .confirm(record, None, record.createdAt).void

  private def activeDraft(
      id: String,
      heldEventId: HeldEventId,
      titleId: GameTitleId,
      mapId: MapMasterId,
  ): IO[Unit] = sql"""
    INSERT INTO match_drafts (
      id, held_event_id, status, game_title_id, map_master_id,
      created_by_account_id, created_at, updated_at
    ) VALUES ($id, $heldEventId, 'draft_ready', $titleId, $mapId, 'account_ponta', $baseTime, $baseTime)
  """.update.run.transact(transactor).void

  private def page(
      search: HeldEventListSearchCriteria,
      sort: HeldEventListSort,
      request: PageRequest,
  ): IO[HeldEventListPage] = reader.list(search, sort, request)

  private def ids(search: HeldEventListSearchCriteria): IO[List[String]] =
    page(search, HeldEventListSort.HeldDesc, PageRequest(1, 100))
      .map(_.page.items.map(_.event.id.value))

  private def metric(
      kind: HeldEventListMetric,
      value: String,
      range: MatchListRecordRange,
      memberId: Option[String],
  ): HeldEventListSearchCriteria = HeldEventListSearchCriteria(metric =
    Some(HeldEventListMetricCriterion(
      kind,
      BigDecimal(value),
      range,
      memberId.map(MemberId.unsafeFromString)
    ))
  )

  test("matches title, season and map on one confirmed match and ignores drafts"):
    for
      _ <- seedMasters
      world <- event("held_world", baseTime.plusSeconds(30))
      second <- event("held_second", baseTime.plusSeconds(20))
      mixed <- event("held_mixed", baseTime.plusSeconds(10))
      draftOnly <- event("held_draft_only", baseTime)
      _ <- create(plain("world-east", world, 1))
      _ <- activeDraft("world-draft-second", world, secondTitleId, secondMapId)
      _ <- create(plain("second-1", second, 1).copy(
        gameTitleId = secondTitleId,
        seasonMasterId = secondSeasonId,
        mapMasterId = secondMapId,
      ))
      _ <- create(plain("mixed-east", mixed, 1))
      _ <- create(plain("mixed-second", mixed, 2).copy(
        gameTitleId = secondTitleId,
        seasonMasterId = secondSeasonId,
        mapMasterId = secondMapId,
      ))
      _ <- activeDraft("draft-only-west", draftOnly, worldId, westId)
      byWorld <- ids(HeldEventListSearchCriteria(gameTitleId = Some(worldId)))
      bySecondSeason <- ids(HeldEventListSearchCriteria(seasonMasterId = Some(secondSeasonId)))
      byWest <- ids(HeldEventListSearchCriteria(mapMasterId = Some(westId)))
      worldOnSecondMap <- ids(HeldEventListSearchCriteria(
        gameTitleId = Some(worldId),
        mapMasterId = Some(secondMapId),
      ))
      unknown <- ids(HeldEventListSearchCriteria(gameTitleId =
        Some(GameTitleId.unsafeFromString("title_unknown"))
      ))
    yield
      assertEquals(byWorld, List(world.value, mixed.value))
      assertEquals(bySecondSeason, List(second.value, mixed.value))
      assertEquals(byWest, Nil)
      assertEquals(worldOnSecondMap, Nil)
      assertEquals(unknown, Nil)

  test("filters inclusive Asia/Tokyo calendar days on the held-event start time"):
    for
      _ <- seedMasters
      aprilLast <- event("held_april_last", Instant.parse("2026-04-30T14:59:59Z"))
      mayFirst <- event("held_may_first", Instant.parse("2026-04-30T15:00:00Z"))
      mayEnd <- event("held_may_end", Instant.parse("2026-05-31T14:59:59Z"))
      _ <- event("held_june_first", Instant.parse("2026-05-31T15:00:00Z"))
      april <- ids(HeldEventListSearchCriteria(to = Some(LocalDate.parse("2026-04-30"))))
      may <- ids(HeldEventListSearchCriteria(
        from = Some(LocalDate.parse("2026-05-01")),
        to = Some(LocalDate.parse("2026-05-31")),
      ))
      singleDay <- ids(HeldEventListSearchCriteria(
        from = Some(LocalDate.parse("2026-04-30")),
        to = Some(LocalDate.parse("2026-04-30")),
      ))
    yield
      assertEquals(april, List(aprilLast.value))
      assertEquals(may, List(mayEnd.value, mayFirst.value))
      assertEquals(singleDay, List(aprilLast.value))

  test("counts only confirmed matches for minMatchCount and totals the filtered events"):
    for
      _ <- seedMasters
      two <- event("held_two", baseTime.plusSeconds(20))
      one <- event("held_one", baseTime.plusSeconds(10))
      _ <- event("held_none", baseTime)
      _ <- create(plain("two-1", two, 1))
      _ <- create(plain("two-2", two, 2))
      _ <- create(plain("one-1", one, 1))
      _ <- activeDraft("one-draft-a", one, worldId, eastId)
      _ <- activeDraft("one-draft-b", one, worldId, eastId)
      atLeastTwo <- page(
        HeldEventListSearchCriteria(minMatchCount = Some(2)),
        HeldEventListSort.HeldDesc,
        PageRequest(1, 10),
      )
      atLeastOne <- page(
        HeldEventListSearchCriteria(minMatchCount = Some(1)),
        HeldEventListSort.HeldDesc,
        PageRequest(2, 1),
      )
      all <- page(HeldEventListSearchCriteria.empty, HeldEventListSort.HeldDesc, PageRequest(1, 10))
    yield
      assertEquals(atLeastTwo.page.items.map(_.event.id), List(two))
      assertEquals((atLeastTwo.page.totalItems, atLeastTwo.totalMatchCount), (1, 2))
      assertEquals(atLeastOne.page.items.map(_.event.id), List(one))
      assertEquals((atLeastOne.page.totalItems, atLeastOne.totalMatchCount), (2, 3))
      assertEquals((all.page.totalItems, all.totalMatchCount), (3, 3))
      assert(all.page.items.forall(_.noteMatch.isEmpty))

  test("searches notes literally and returns the first hit with the other hit count"):
    for
      _ <- seedMasters
      percent <- event("held_percent", baseTime.plusSeconds(30))
      plainWin <- event("held_plain_win", baseTime.plusSeconds(20))
      underscore <- event("held_underscore", baseTime.plusSeconds(10))
      _ <- event("held_no_note", baseTime)
      _ <- create(withNote(plain("percent-3", percent, 3), "Big 100% WIN again"))
      _ <- create(withNote(plain("percent-2", percent, 2), "Big 100% WIN"))
      _ <- create(plain("percent-1", percent, 1))
      _ <- create(withNote(plain("plain-1", plainWin, 1), "100x win"))
      _ <- create(withNote(plain("underscore-1", underscore, 1), "a_b"))
      _ <- create(withNote(plain("underscore-2", underscore, 2), "aXb"))
      byPercent <- page(
        HeldEventListSearchCriteria(noteQuery = Some("100%")),
        HeldEventListSort.HeldDesc,
        PageRequest(1, 10),
      )
      caseless <- ids(HeldEventListSearchCriteria(noteQuery = Some("win")))
      literalUnderscore <- page(
        HeldEventListSearchCriteria(noteQuery = Some("_")),
        HeldEventListSort.HeldDesc,
        PageRequest(1, 10),
      )
    yield
      assertEquals(byPercent.page.items.map(_.event.id), List(percent))
      assertEquals(byPercent.totalMatchCount, 3)
      assertEquals(
        byPercent.page.items.flatMap(_.noteMatch),
        List(HeldEventNoteMatch(MatchId.unsafeFromString("percent-2"), 2, "Big 100% WIN", 1)),
      )
      assertEquals(caseless, List(percent.value, plainWin.value))
      assertEquals(literalUnderscore.page.items.map(_.event.id), List(underscore))
      assertEquals(
        literalUnderscore.page.items.flatMap(_.noteMatch).map(_.otherMatchCount),
        List(0),
      )

  test("projects rounded average ranks and rank counts and compares the rounded average"):
    for
      _ <- seedMasters
      thirds <- event("held_thirds", baseTime.plusSeconds(20))
      fourths <- event("held_fourths", baseTime.plusSeconds(10))
      empty <- event("held_empty", baseTime)
      // ponta: 1, 2, 2 -> 1.666... displayed and compared as 1.67.
      _ <- create(confirm("thirds-1", thirds, 1, (1, 2, 3, 4)))
      _ <- create(confirm("thirds-2", thirds, 2, (2, 1, 3, 4)))
      _ <- create(confirm("thirds-3", thirds, 3, (2, 1, 4, 3)))
      _ <- create(confirm("fourths-1", fourths, 1, (4, 1, 2, 3)))
      _ <- create(confirm("fourths-2", fourths, 2, (4, 3, 2, 1)))
      listed <-
        page(HeldEventListSearchCriteria.empty, HeldEventListSort.HeldDesc, PageRequest(1, 10))
      // Unrounded 1.666... < 1.67 and 1.333... > 1.33: only the rounded value satisfies both.
      roundedUp <- ids(metric(
        HeldEventListMetric.AverageRank,
        "1.67",
        MatchListRecordRange.Gte,
        Some("member_ponta")
      ))
      roundedDown <- ids(metric(
        HeldEventListMetric.AverageRank,
        "1.33",
        MatchListRecordRange.Lte,
        Some("member_akane_mami")
      ))
      anyTwoFourths <-
        ids(metric(HeldEventListMetric.Rank4Count, "2", MatchListRecordRange.Gte, None))
      euWins <- ids(metric(
        HeldEventListMetric.Rank1Count,
        "1",
        MatchListRecordRange.Gte,
        Some("member_eu")
      ))
      noWinsForPonta <- ids(metric(
        HeldEventListMetric.Rank1Count,
        "0",
        MatchListRecordRange.Lte,
        Some("member_ponta")
      ))
      anyNoSecond <-
        ids(metric(HeldEventListMetric.Rank2Count, "0", MatchListRecordRange.Lte, None))
    yield
      val results = listed.page.items.map(item => item.event.id -> item.playerResults).toMap
      assertEquals(
        results(thirds).map(result =>
          (result.memberId.value, result.averageRank, result.rankCounts)
        ),
        List(
          ("member_akane_mami", BigDecimal("1.33"), List(2, 1, 0, 0)),
          ("member_eu", BigDecimal("3.67"), List(0, 0, 1, 2)),
          ("member_otaka", BigDecimal("3.33"), List(0, 0, 2, 1)),
          ("member_ponta", BigDecimal("1.67"), List(1, 2, 0, 0)),
        ),
      )
      assertEquals(results(empty), Nil)
      assertEquals(roundedUp, List(thirds.value, fourths.value))
      assertEquals(roundedDown, List(thirds.value))
      assertEquals(anyTwoFourths, List(thirds.value, fourths.value))
      assertEquals(euWins, List(fourths.value))
      assertEquals(noWinsForPonta, List(fourths.value))
      // Every event with confirmed matches has someone without a 2nd place; the empty one never matches.
      assertEquals(anyNoSecond, List(thirds.value, fourths.value))

  test("orders both directions stably on equal start times and keeps the latest event fixed"):
    val tie = baseTime.plusSeconds(60)
    for
      _ <- seedMasters
      older <- event("held_older", baseTime)
      tieA <- event("held_tie_A", tie)
      tieB <- event("held_tie_b", tie)
      tieUnderscore <- event("held_tie__", tie)
      _ <- create(withNote(plain("older-1", older, 1), "memo"))
      descending <- (1 to 4).toList
        .traverse(n =>
          page(HeldEventListSearchCriteria.empty, HeldEventListSort.HeldDesc, PageRequest(n, 1))
        )
      ascending <- (1 to 4).toList
        .traverse(n =>
          page(HeldEventListSearchCriteria.empty, HeldEventListSort.HeldAsc, PageRequest(n, 1))
        )
      filtered <- page(
        HeldEventListSearchCriteria(noteQuery = Some("memo")),
        HeldEventListSort.HeldAsc,
        PageRequest(1, 10),
      )
      none <- page(
        HeldEventListSearchCriteria(noteQuery = Some("absent")),
        HeldEventListSort.HeldDesc,
        PageRequest(1, 10),
      )
      snapshot <- (for
        result <- PostgresHeldEventList
          .list(HeldEventListSearchCriteria.empty, HeldEventListSort.HeldAsc, PageRequest(1, 1))
        isolation <- sql"SHOW transaction_isolation".query[String].unique
      yield (result, isolation)).transact(transactor)
    yield
      // COLLATE "C" byte order: 'A' < '_' < 'b'.
      val newestFirst = List(tieB, tieUnderscore, tieA, older)
      assertEquals(descending.flatMap(_.page.items.map(_.event.id)), newestFirst)
      assertEquals(ascending.flatMap(_.page.items.map(_.event.id)), newestFirst.reverse)
      assert((descending ++ ascending).forall(_.latestHeldEventId.contains(tieB)))
      assertEquals(filtered.page.items.map(_.event.id), List(older))
      assertEquals(filtered.latestHeldEventId, Some(tieB))
      assertEquals((none.page.totalItems, none.totalMatchCount), (0, 0))
      assertEquals(none.latestHeldEventId, Some(tieB))
      assertEquals(snapshot._1.latestHeldEventId, Some(tieB))
      assertEquals(snapshot._2, "repeatable read")
end PostgresHeldEventListReadModelSpec
