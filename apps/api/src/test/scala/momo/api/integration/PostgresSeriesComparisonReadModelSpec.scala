package momo.api.integration

import java.time.Instant

import cats.effect.IO

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.repositories.postgres.*

final class PostgresSeriesComparisonReadModelSpec extends IntegrationSuite:

  private val now = Instant.parse("2026-05-20T12:00:00Z")
  private val gameTitleId = GameTitleId.unsafeFromString("title_series_comparison")
  private val mapMasterId = MapMasterId.unsafeFromString("map_series_comparison")
  private val seasonMasterId = SeasonMasterId.unsafeFromString("season_series_comparison")
  private val heldEventId = HeldEventId.unsafeFromString("held_series_comparison")

  private def gameTitles = new PostgresGameTitlesRepository[IO](transactor)
  private def mapMasters = new PostgresMapMastersRepository[IO](transactor)
  private def seasonMasters = new PostgresSeasonMastersRepository[IO](transactor)
  private def heldEvents = new PostgresHeldEventsRepository[IO](transactor)
  private def matches = new PostgresMatchesRepository[IO](transactor)
  private def readModel = PostgresSeriesComparisonReadModel[IO](transactor)

  test("loads options and confirmed player rows for each comparison scope"):
    for
      _ <- seedPrereqs
      _ <- matches.create(sampleMatch("match_series_comparison_1", 1))
      options <- readModel.options
      resolvedOverall <- readModel.resolveScope(SeriesComparisonScope.Overall(gameTitleId))
      rows <- resolvedOverall match
        case Some(scope) => readModel.loadRows(scope)
        case None => IO(fail("overall scope was not resolved"))
      resolvedSeason <- readModel.resolveScope(SeriesComparisonScope.Season(gameTitleId, seasonMasterId))
      seasonRows <- resolvedSeason match
        case Some(scope) => readModel.loadRows(scope)
        case None => IO(fail("season scope was not resolved"))
      resolvedMap <- readModel.resolveScope(SeriesComparisonScope.Map(gameTitleId, mapMasterId))
      mapRows <- resolvedMap match
        case Some(scope) => readModel.loadRows(scope)
        case None => IO(fail("map scope was not resolved"))
    yield
      val series = options.series.find(_.gameTitleId == gameTitleId)
        .getOrElse(fail(s"series option missing: ${options.series}"))
      assertEquals(options.latestConfirmedGameTitleId, Some(gameTitleId))
      assertEquals(series.confirmedMatchCount, 1)
      assertEquals(series.seasons.map(_.confirmedMatchCount), List(1))
      assertEquals(series.maps.map(_.confirmedMatchCount), List(1))

      assertEquals(rows.size, 4)
      assertEquals(seasonRows.map(_.memberId), rows.map(_.memberId))
      assertEquals(mapRows.map(_.memberId), rows.map(_.memberId))

      val ponta = rows.find(_.memberId == MemberId.unsafeFromString("member_ponta"))
        .getOrElse(fail(s"ponta row missing: $rows"))
      assertEquals(ponta.rank.value, 1)
      assertEquals(ponta.totalAssetsManYen.value, 10000)
      assertEquals(ponta.revenueManYen.value, 2500)
      assertEquals(ponta.incidents.destination, 4)
      assertEquals(ponta.incidents.suriNoGinji, 1)

  private def seedPrereqs: IO[Unit] =
    for
      _ <- gameTitles.create(GameTitle(gameTitleId, "Series Comparison", "momotetsu2", 1, now))
      _ <- mapMasters.create(MapMaster(mapMasterId, gameTitleId, "East", 1, now))
      _ <- seasonMasters.create(SeasonMaster(seasonMasterId, gameTitleId, "Spring", 1, now))
      _ <- heldEvents.create(HeldEvent(heldEventId, now))
    yield ()

  private def sampleMatch(id: String, matchNo: Int): MatchRecord = MatchRecord(
    id = MatchId.unsafeFromString(id),
    heldEventId = heldEventId,
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNo),
    gameTitleId = gameTitleId,
    layoutFamily = "momotetsu2",
    seasonMasterId = seasonMasterId,
    ownerMemberId = MemberId.unsafeFromString("member_ponta"),
    mapMasterId = mapMasterId,
    playedAt = now,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    players = FourPlayers(
      player("member_ponta", 1, 1, 10000, 2500, destination = 4, ginji = 1),
      player("member_akane_mami", 2, 2, 8000, 2200, destination = 2, ginji = 0),
      player("member_otaka", 3, 3, 6000, 1000, destination = 1, ginji = 0),
      player("member_eu", 4, 4, 3000, 500, destination = 0, ginji = 2),
    ),
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    createdAt = now,
  )

  private def player(
      memberId: String,
      playOrder: Int,
      rank: Int,
      totalAssets: Int,
      revenue: Int,
      destination: Int,
      ginji: Int,
  ): PlayerResult = PlayerResult.unsafeFromInts(
    memberId = MemberId.unsafeFromString(memberId),
    playOrder = playOrder,
    rank = rank,
    totalAssetsManYen = totalAssets,
    revenueManYen = revenue,
    incidents = IncidentCounts.unsafeFromInts(
      destination = destination,
      plusStation = 0,
      minusStation = 0,
      cardStation = 0,
      cardShop = 0,
      suriNoGinji = ginji,
    ),
  )
