package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{
  ManYen, MatchNoInEvent, PlayOrder, Rank, SeriesComparisonIncidentCountsRow,
  SeriesComparisonMatchPlayerRow, SeriesComparisonOptionsData, SeriesComparisonResolvedScope,
  SeriesComparisonScope,
}
import momo.api.repositories.SeriesComparisonReadModel
import momo.api.testing.AppErrorAssertions.{assertAppError, assertRight}

final class GetSeriesComparisonSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-10T12:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title_momotetsu_2")
  private val seasonId = SeasonMasterId.unsafeFromString("season_2026_spring")
  private val mapId = MapMasterId.unsafeFromString("map_japan")
  private val DoubleDelta = 0.0001
  private val resolvedScope = SeriesComparisonResolvedScope(
    gameTitleId = titleId,
    gameTitleName = "桃鉄2",
    layoutFamily = "momotetsu2",
    scopeKind = "overall",
    scopeId = None,
    scopeName = "総合",
  )

  test("aggregates strategic comparison metrics from confirmed match rows"):
    val usecase = GetSeriesComparison[IO](StaticReadModel(Some(resolvedScope), sampleRows))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = assertRight(result)
      assertEquals(response.matchCount, 3)
      assertEquals(response.schemaVersion, 4)
      assertEquals(response.players.map(_.memberId), List("ponta", "akane", "otaka", "eu"))

      val metrics = response.metricsByPlayer.map(entry => entry.memberId -> entry.metrics).toMap
      val ponta = metrics("ponta")
      val akane = metrics("akane")
      val eu = metrics("eu")

      assertOptionDouble(ponta.rank.average, 4.0 / 3.0)
      assertEquals(ponta.podium.count, 3)
      assertOptionDouble(ponta.podium.rate, 1.0)
      assertEquals(ponta.ginji.count, 1)
      assertEquals(ponta.ginji.encounterMatches, 1)
      assertOptionDouble(ponta.ginji.encounterRate, 1.0 / 3.0)
      assertOptionDouble(ponta.ginji.resilienceRankAverage, 1.0)
      assertOptionDouble(ponta.playOrder.assetsDiff, 940.0 / 3.0)
      assertOptionDouble(ponta.playOrder.revenueDiff, 70.0 / 3.0)
      assertEquals(ponta.playOrder.breakdown.map(_.playOrder), List(1, 2, 3, 4))
      assertEquals(ponta.playOrder.breakdown.map(_.matchCount), List(1, 1, 1, 0))
      assertOptionDouble(ponta.playOrder.breakdown.head.rankAverage, 1.0)
      assertOptionDouble(ponta.destination.conversionDelta, 4.0 / 3.0)
      assertEquals(ponta.revenueOutcome.top.targetCount, 0)
      assertEquals(ponta.revenueOutcome.top.status, "no_target")
      assertEquals(ponta.revenueOutcome.nonTopWinCount, 2)
      assertEquals(ponta.revenueOutcome.lowRevenue.targetCount, 0)
      assertEquals(ponta.destinationOutcome.top.targetCount, 0)
      assertEquals(ponta.destinationOutcome.lowDestination.targetCount, 2)
      assertEquals(ponta.destinationOutcome.lowDestination.podiumCount, 2)
      assertOptionDouble(ponta.destinationOutcome.lowDestination.podiumRate, 1.0)

      assertEquals(akane.nonRevenue.highRevenueTopCount, 3)
      assertEquals(akane.nonRevenue.highRevenueNoWinCount, 2)
      assertOptionDouble(akane.nonRevenue.highRevenueNoWinRate, 2.0 / 3.0)
      assertEquals(akane.revenueOutcome.top.targetCount, 3)
      assertEquals(akane.revenueOutcome.top.winCount, 1)
      assertOptionDouble(akane.revenueOutcome.top.winRate, 1.0 / 3.0)
      assertEquals(akane.revenueOutcome.top.podiumCount, 2)
      assertOptionDouble(akane.revenueOutcome.top.podiumRate, 2.0 / 3.0)
      assertEquals(akane.revenueOutcome.top.lowerHalfCount, 1)
      assertEquals(akane.revenueOutcome.top.rankDistribution.map(_.count), List(1, 1, 1, 0))
      assertEquals(akane.destinationOutcome.top.targetCount, 2)
      assertEquals(akane.destinationOutcome.top.winCount, 1)
      assertEquals(akane.destinationOutcome.top.lowerHalfCount, 1)
      assertEquals(akane.destinationOutcome.top.status, "reference")

      assertEquals(eu.ginji.count, 2)
      assertEquals(eu.ginji.multiEncounterMatchCount, 1)
      assertEquals(eu.ginji.maxInSingleMatch, 2)
      assertEquals(eu.destinationOutcome.zeroDestination.targetCount, 3)
      assertEquals(eu.destinationOutcome.zeroDestination.podiumCount, 0)
      assertOptionDouble(eu.destinationOutcome.zeroDestination.lowerHalfRate, 1.0)

      assertEquals(response.trends.rankCumulativeAverage.size, 4)
      assertEquals(response.trends.rankCumulativeStandardDeviation.size, 4)
      assertOptionDouble(
        response.trends.rankCumulativeStandardDeviation.head.points.head.value,
        0.0,
      )
      assertOptionDouble(response.trends.rankCumulativeStandardDeviation.head.points(1).value, 0.5)
      assertEquals(
        response.histograms.assets.series.map(_.memberId),
        response.players.map(_.memberId),
      )
      assertEquals(
        response.histograms.assets.bins.map(_.label),
        List("0-499", "500-999", "1000-1499", "1500+"),
      )
      assertEquals(response.playOrderBaselines.map(_.playOrder), List(1, 2, 3, 4))
      assertOptionDouble(response.playOrderBaselines.head.assetsAverage, 760.0)
      assertOptionDouble(response.playOrderBaselines.head.revenueAverage, 180.0)
      val pontaVsAkane = response.headToHead.entries
        .find(entry => entry.subjectMemberId == "ponta" && entry.opponentMemberId == "akane")
        .getOrElse(fail(s"ponta vs akane entry missing: ${response.headToHead.entries}"))
      assertEquals(pontaVsAkane.matchCount, 3)
      assertEquals(pontaVsAkane.betterRankCount, 2)
      assertOptionDouble(pontaVsAkane.betterRankRate, 2.0 / 3.0)
      assertOptionDouble(pontaVsAkane.averageRankDiff, 2.0 / 3.0)
      assertOptionDouble(pontaVsAkane.averageAssetsDiff, 200.0)
      assertEquals(response.matchPlayerPoints.size, 12)
      val firstPoint = response.matchPlayerPoints
        .find(point => point.matchIndex == 1 && point.memberId == "ponta")
        .getOrElse(fail(s"first point missing: ${response.matchPlayerPoints}"))
      assertEquals(firstPoint.totalAssets, 1000)
      assertOptionDouble(firstPoint.revenueAssetRate, 0.2)
      assertOptionDouble(Some(firstPoint.assetsRank), 1.0)
      assertOptionDouble(Some(firstPoint.revenueRank), 2.0)
      val pontaForm = response.recentFormByPlayer.find(_.memberId == "ponta")
        .getOrElse(fail(s"ponta recent form missing: ${response.recentFormByPlayer}"))
      assertEquals(pontaForm.windowSize, 8)
      assertEquals(pontaForm.targetCount, 3)
      assertOptionDouble(pontaForm.averageRank, 4.0 / 3.0)
      assertOptionDouble(pontaForm.podiumRate, 1.0)
      assertEquals(pontaForm.winStreak, 1)
      assertEquals(pontaForm.podiumStreak, 3)
      assertEquals(pontaForm.lowerHalfStreak, 0)
      assertEquals(
        response.playerPerformanceProfiles.entries.map(_.memberId),
        response.players.map(_.memberId),
      )
      assert(response.playerPerformanceProfiles.entries.forall(_.profileKind.nonEmpty))
      assert(response.playerPerformanceProfiles.entries.forall(_.strategyKind.nonEmpty))
      val akaneProfile = response.playerPerformanceProfiles.entries.find(_.memberId == "akane")
        .getOrElse(fail(s"akane profile missing: ${response.playerPerformanceProfiles.entries}"))
      val pontaProfile = response.playerPerformanceProfiles.entries.find(_.memberId == "ponta")
        .getOrElse(fail(s"ponta profile missing: ${response.playerPerformanceProfiles.entries}"))
      assertOptionDouble(pontaProfile.averageRevenueAssetRate, 0.2412698412)
      assertEquals(akaneProfile.strategyKind, Some("property_focused"))
      assertEquals(pontaProfile.strategyKind, Some("card_focused"))
      val euProfile = response.playerPerformanceProfiles.entries.find(_.memberId == "eu")
        .getOrElse(fail(s"eu profile missing: ${response.playerPerformanceProfiles.entries}"))
      assertEquals(euProfile.strategyKind, Some("property_focused"))
      assertEquals(response.matchNoInEventBreakdown.map(_.matchNoInEvent), List(1, 2, 3))
      assertEquals(
        response.matchNoInEventBreakdown.head.playerRows.map(_.targetCount),
        List(1, 1, 1, 1),
      )
      val firstTimeline = response.matchTimeline.head
      assertEquals(firstTimeline.matchIndex, 1)
      assertEquals(firstTimeline.winnerMemberId, Some("ponta"))
      assertEquals(firstTimeline.revenueTopMemberIds, List("akane"))
      assert(
        firstTimeline.flags.contains("revenue_top_no_win"),
        s"unexpected flags: ${firstTimeline.flags}",
      )
      assert(
        firstTimeline.flags.contains("ginji_storm"),
        s"unexpected flags: ${firstTimeline.flags}",
      )
      assert(response.matchTimeline.exists(_.flags.contains("asset_blowout")))
      assert(response.highlights.exists(_.id == "highlight.destinationIndependent"))
      assert(response.dataQuality.items.exists(item =>
        item.metricId == "ginji.resilienceRankAverage" && item.playerMemberId.contains("ponta") &&
          item.status == "reference"
      ))
      assert(response.dataQuality.items.exists(item =>
        item.metricId == "revenueOutcome.topWinRate" && item.playerMemberId.contains("akane") &&
          item.targetCount == 3 && item.status == "ok"
      ))
      assert(response.dataQuality.items.exists(item =>
        item.metricId == "destinationOutcome.lowDestinationPodiumRate" &&
          item.playerMemberId.contains("ponta") && item.targetCount == 2 &&
          item.status == "reference"
      ))

  test("returns an empty aggregate when the selected scope has no confirmed matches"):
    val usecase = GetSeriesComparison[IO](StaticReadModel(Some(resolvedScope), Nil))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = assertRight(result)
      assertEquals(response.matchCount, 0)
      assertEquals(response.players, Nil)
      assertEquals(response.metricsByPlayer, Nil)
      assertEquals(response.headToHead.entries, Nil)
      assertEquals(response.matchPlayerPoints, Nil)
      assertEquals(response.recentFormByPlayer, Nil)
      assertEquals(response.playerPerformanceProfiles.entries, Nil)
      assertEquals(response.matchNoInEventBreakdown, Nil)
      assertEquals(response.matchTimeline, Nil)
      assertEquals(response.playOrderBaselines, Nil)
      assertEquals(response.dataQuality.items, Nil)

  test("returns not found when the selected scope cannot be resolved"):
    val usecase = GetSeriesComparison[IO](StaticReadModel(None, Nil))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId))
    yield assertAppError(result, "NOT_FOUND", "series comparison scope was not found")

  test("orders real members by the fixed comparison order independent of play order"):
    val rows = List(
      row(1, "member_ponta", "ぽんた", 1, 1, 1000, 200, destination = 1, ginji = 0),
      row(1, "member_akane_mami", "あかねまみ", 2, 2, 900, 180, destination = 1, ginji = 0),
      row(1, "member_otaka", "おーたか", 3, 3, 800, 160, destination = 1, ginji = 0),
      row(1, "member_eu", "いーゆー", 4, 4, 700, 140, destination = 1, ginji = 0),
    )
    val usecase = GetSeriesComparison[IO](StaticReadModel(Some(resolvedScope), rows))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = assertRight(result)
      val expected = List("member_eu", "member_ponta", "member_akane_mami", "member_otaka")
      assertEquals(response.players.map(_.memberId), expected)
      assertEquals(response.metricsByPlayer.map(_.memberId), expected)
      assertEquals(response.trends.rankCumulativeAverage.map(_.memberId), expected)
      assertEquals(response.histograms.assets.series.map(_.memberId), expected)

  test("classifies strategy kind only when revenue asset rate differs from the median threshold"):
    val rows = List(
      row(1, "low", "low", 1, 1, 1000, 290, destination = 0, ginji = 0),
      row(1, "near_low", "near low", 2, 2, 1000, 305, destination = 0, ginji = 0),
      row(1, "near_high", "near high", 3, 3, 1000, 310, destination = 0, ginji = 0),
      row(1, "high", "high", 4, 4, 1000, 340, destination = 0, ginji = 0),
    )
    val usecase = GetSeriesComparison[IO](StaticReadModel(Some(resolvedScope), rows))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = assertRight(result)
      val profiles = response.playerPerformanceProfiles.entries
        .map(entry => entry.memberId -> entry.strategyKind).toMap
      assertEquals(profiles("low"), Some("card_focused"))
      assertEquals(profiles("near_low"), Some("balanced"))
      assertEquals(profiles("near_high"), Some("balanced"))
      assertEquals(profiles("high"), Some("property_focused"))

  private def sampleRows: List[SeriesComparisonMatchPlayerRow] = List(
    row(1, "ponta", "ponta", 1, 1, 1000, 200, destination = 3, ginji = 1),
    row(1, "akane", "akane", 2, 2, 800, 250, destination = 1, ginji = 0),
    row(1, "otaka", "otaka", 3, 3, 500, 100, destination = 5, ginji = 0),
    row(1, "eu", "eu", 4, 4, 100, 50, destination = 0, ginji = 2),
    row(2, "akane", "akane", 1, 1, 1200, 300, destination = 3, ginji = 1),
    row(2, "ponta", "ponta", 2, 2, 700, 180, destination = 1, ginji = 0),
    row(2, "otaka", "otaka", 3, 3, 400, 160, destination = 2, ginji = 0),
    row(2, "eu", "eu", 4, 4, 50, 20, destination = 0, ginji = 0),
    row(3, "eu", "eu", 1, 4, 80, 40, destination = 0, ginji = 0),
    row(3, "akane", "akane", 2, 3, 600, 500, destination = 5, ginji = 0),
    row(3, "ponta", "ponta", 3, 1, 1500, 400, destination = 1, ginji = 0),
    row(3, "otaka", "otaka", 4, 2, 1000, 350, destination = 2, ginji = 1),
  )

  private def row(
      matchNo: Int,
      memberId: String,
      displayName: String,
      playOrder: Int,
      rank: Int,
      assets: Int,
      revenue: Int,
      destination: Int,
      ginji: Int,
  ): SeriesComparisonMatchPlayerRow = SeriesComparisonMatchPlayerRow(
    matchId = MatchId.unsafeFromString(s"match-$matchNo"),
    playedAt = now.plusSeconds(matchNo.toLong),
    heldEventId = HeldEventId.unsafeFromString("held_2026_05_10"),
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNo),
    gameTitleId = titleId,
    seasonMasterId = seasonId,
    mapMasterId = mapId,
    memberId = MemberId.unsafeFromString(memberId),
    memberDisplayName = displayName,
    playOrder = PlayOrder.unsafeFromInt(playOrder),
    rank = Rank.unsafeFromInt(rank),
    totalAssetsManYen = ManYen.unsafeFromInt(assets),
    revenueManYen = ManYen.unsafeFromInt(revenue),
    incidents = SeriesComparisonIncidentCountsRow(
      destination = destination,
      plusStation = 0,
      minusStation = 0,
      cardStation = 0,
      cardShop = 0,
      suriNoGinji = ginji,
    ),
  )

  private def assertOptionDouble(actual: Option[Double], expected: Double, delta: Double): Unit =
    actual match
      case Some(value) =>
        assert(math.abs(value - expected) <= delta, s"expected $expected within $delta, got $value")
      case None => fail(s"expected $expected, got None")

  private def assertOptionDouble(actual: Option[Double], expected: Double): Unit =
    assertOptionDouble(actual, expected, DoubleDelta)

  private final case class StaticReadModel(
      resolved: Option[SeriesComparisonResolvedScope],
      rows: List[SeriesComparisonMatchPlayerRow],
  ) extends SeriesComparisonReadModel[IO]:
    override def options: IO[SeriesComparisonOptionsData] = IO
      .pure(SeriesComparisonOptionsData(None, Nil))

    override def resolveScope(
        scope: SeriesComparisonScope
    ): IO[Option[SeriesComparisonResolvedScope]] = IO.pure(resolved)

    override def loadRows(
        scope: SeriesComparisonResolvedScope
    ): IO[List[SeriesComparisonMatchPlayerRow]] = IO.pure(rows)
