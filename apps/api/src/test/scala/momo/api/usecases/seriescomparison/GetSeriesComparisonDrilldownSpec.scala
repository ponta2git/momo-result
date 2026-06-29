package momo.api.usecases.seriescomparison

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.constraints.RefinedTypes
import momo.api.domain.constraints.RefinedTypes.{MetricIdString, MetricKey}
import momo.api.domain.ids.*
import momo.api.domain.{
  ManYen,
  MatchNoInEvent,
  PlayOrder,
  Rank,
  SeriesComparisonIncidentCountsRow,
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonOptionsData,
  SeriesComparisonResolvedScope,
  SeriesComparisonScope
}
import momo.api.repositories.SeriesComparisonReadModel
import momo.api.testing.AppErrorAssertions.{assertAppError, assertRight}

final class GetSeriesComparisonDrilldownSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-10T12:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title_momotetsu_2")
  private val seasonId = SeasonMasterId.unsafeFromString("season_2026_spring")
  private val mapId = MapMasterId.unsafeFromString("map_japan")
  private val memberId = MemberId.unsafeFromString("ponta")
  private val resolvedScope = SeriesComparisonResolvedScope(
    gameTitleId = titleId,
    gameTitleName = "桃鉄2",
    layoutFamily = "momotetsu2",
    scopeKind = "overall",
    scopeId = None,
    scopeName = "総合",
  )
  private val rankAverageHistory = metricId("rank.averageHistory")
  private val playOrderRankHistory = metricId("playOrder.rankHistory")
  private val DoubleDelta = 0.0001

  test("builds rank average history drilldown by match and held event"):
    val usecase = GetSeriesComparisonDrilldown[IO](StaticReadModel(Some(resolvedScope), sampleRows))

    for result <- usecase.run(
        SeriesComparisonScope.Overall(titleId),
        rankAverageHistory,
        memberId,
      )
    yield
      val response = assertRight(result)
      assertEquals(response.schemaVersion, 1)
      assertEquals(response.metricId, "rank.averageHistory")
      assertEquals(response.player.displayName, "ぽんた")
      assertEquals(response.playOrderRankHistory, None)
      val payload = response.rankAverageHistory.getOrElse(fail("expected rank payload"))
      assertEquals(payload.summary.targetCount, 3)
      assertEquals(payload.summary.status, "ok")
      assertOptionDouble(payload.summary.currentAverageRank, 7.0 / 3.0)
      assertOptionDouble(payload.summary.averageRankDeltaFromFirst, -5.0 / 3.0)
      assertOptionDouble(payload.summary.latestHeldEventAverageRankDelta, -2.0 / 3.0)

      assertEquals(payload.matchRows.map(_.rank), List(4, 2, 1))
      assertEquals(payload.matchRows.map(_.previousRank), List(None, Some(4), Some(2)))
      assertEquals(payload.matchRows.map(_.rankDelta), List(None, Some(-2), Some(-1)))
      assertEquals(payload.matchRows.map(_.matchNoInEvent), List(1, 2, 1))
      assertOptionDouble(payload.matchRows(1).cumulativeAverageRankDelta, -1.0)
      assertOptionDouble(payload.matchRows(2).cumulativeAverageRankDelta, -2.0 / 3.0)

      assertEquals(payload.heldEventRows.map(_.heldEventId), List("held_a", "held_b"))
      assertEquals(payload.heldEventRows.map(_.ranks), List(List(4, 2), List(1)))
      assertEquals(payload.heldEventRows.map(_.eventRankDelta), List(Some(-2), None))
      assertEquals(payload.heldEventRows.head.cumulativeAverageBefore, None)
      assertOptionDouble(payload.heldEventRows(1).cumulativeAverageBefore, 3.0)
      assertOptionDouble(payload.heldEventRows(1).cumulativeAverageDelta, -2.0 / 3.0)
      assertEquals(response.dataQuality.items.map(_.status), List("ok"))

  test("builds play order rank history drilldown with baselines and event rows"):
    val usecase = GetSeriesComparisonDrilldown[IO](
      StaticReadModel(Some(resolvedScope), playOrderRows)
    )

    for result <- usecase.run(
        SeriesComparisonScope.Overall(titleId),
        playOrderRankHistory,
        memberId,
      )
    yield
      val response = assertRight(result)
      assertEquals(response.rankAverageHistory, None)
      val payload = response.playOrderRankHistory.getOrElse(fail("expected play order payload"))
      assertEquals(payload.summary.targetCount, 5)
      assertEquals(payload.summary.bestPlayOrder, Some(1))
      assertOptionDouble(payload.summary.bestPlayOrderAverageRank, 1.5)
      assertEquals(payload.summary.worstPlayOrder, Some(3))
      assertOptionDouble(payload.summary.worstPlayOrderAverageRank, 4.0)
      assertOptionDouble(payload.summary.spread, 2.5)
      assertEquals(
        payload.summary.countsByPlayOrder.map(row => row.playOrder -> row.matchCount),
        List(1 -> 2, 2 -> 2, 3 -> 1, 4 -> 0),
      )

      assertEquals(payload.averageTrendRows.map(_.playOrder), List(1, 2, 1, 3, 2))
      assertEquals(payload.averageTrendRows.map(_.playOrderOccurrenceIndex), List(1, 1, 2, 1, 2))
      assertEquals(payload.averageTrendRows.map(_.rank), List(2, 4, 1, 4, 2))
      assertEquals(
        payload.averageTrendRows.map(_.previousCumulativeAverageRankByPlayOrder),
        List(
          None,
          None,
          Some(2.0),
          None,
          Some(4.0),
        )
      )
      assertOptionDouble(
        Some(payload.averageTrendRows(2).cumulativeAverageRankByPlayOrder),
        1.5
      )
      assertOptionDouble(
        payload.averageTrendRows(2).cumulativeAverageRankDeltaByPlayOrder,
        -0.5
      )
      assertOptionDouble(
        Some(payload.averageTrendRows(4).cumulativeAverageRankByPlayOrder),
        3.0
      )
      assertOptionDouble(
        payload.averageTrendRows(4).cumulativeAverageRankDeltaByPlayOrder,
        -1.0
      )

      val byPlayOrder = payload.playOrderRows.map(row => row.playOrder -> row).toMap
      assertOptionDouble(byPlayOrder(1).rankAverage, 1.5)
      assertOptionDouble(byPlayOrder(1).baselineRankAverage, 1.5)
      assertOptionDouble(byPlayOrder(1).baselineDelta, 0.0)
      assertOptionDouble(byPlayOrder(2).rankAverage, 3.0)
      assertOptionDouble(byPlayOrder(2).baselineRankAverage, 2.5)
      assertOptionDouble(byPlayOrder(2).baselineDelta, 0.5)
      assertEquals(byPlayOrder(2).rankDistribution.map(_.count), List(0, 1, 0, 1))
      assertEquals(byPlayOrder(4).matchCount, 0)
      assertEquals(byPlayOrder(4).rankAverage, None)

      assertEquals(payload.averageTrendRows.map(_.matchNoInEvent), List(1, 2, 1, 2, 1))

  test("returns no target drilldown when player has no rows in scope"):
    val usecase = GetSeriesComparisonDrilldown[IO](StaticReadModel(Some(resolvedScope), sampleRows))

    for result <- usecase.run(
        SeriesComparisonScope.Overall(titleId),
        rankAverageHistory,
        MemberId.unsafeFromString("absent"),
      )
    yield
      val response = assertRight(result)
      val payload = response.rankAverageHistory.getOrElse(fail("expected rank payload"))
      assertEquals(payload.summary.status, "no_target")
      assertEquals(payload.summary.targetCount, 0)
      assertEquals(payload.matchRows, Nil)
      assertEquals(payload.heldEventRows, Nil)
      assertEquals(response.dataQuality.items.head.status, "no_target")

  test("returns not found when scope cannot be resolved"):
    val usecase = GetSeriesComparisonDrilldown[IO](StaticReadModel(None, Nil))

    for result <- usecase.run(
        SeriesComparisonScope.Overall(titleId),
        rankAverageHistory,
        memberId,
      )
    yield assertAppError(result, "NOT_FOUND", "series comparison scope was not found")

  private def sampleRows: List[SeriesComparisonMatchPlayerRow] = List(
    row(1, "held_a", 1, "ponta", "ぽんた", 4),
    row(1, "held_a", 1, "akane", "あかね", 1),
    row(2, "held_a", 2, "ponta", "ぽんた", 2),
    row(2, "held_a", 2, "akane", "あかね", 3),
    row(3, "held_b", 1, "ponta", "ぽんた", 1),
    row(3, "held_b", 1, "akane", "あかね", 4),
  )

  private def playOrderRows: List[SeriesComparisonMatchPlayerRow] = List(
    rowWithPlayOrder(1, "held_a", 1, "ponta", "ぽんた", 2, 1, 1000, 100),
    rowWithPlayOrder(1, "held_a", 1, "akane", "あかね", 1, 2, 900, 90),
    rowWithPlayOrder(2, "held_a", 2, "ponta", "ぽんた", 4, 2, 800, 80),
    rowWithPlayOrder(2, "held_a", 2, "akane", "あかね", 1, 1, 1200, 120),
    rowWithPlayOrder(3, "held_b", 1, "ponta", "ぽんた", 1, 1, 1400, 140),
    rowWithPlayOrder(3, "held_b", 1, "akane", "あかね", 3, 2, 700, 70),
    rowWithPlayOrder(4, "held_b", 2, "ponta", "ぽんた", 4, 3, 750, 75),
    rowWithPlayOrder(4, "held_b", 2, "akane", "あかね", 2, 1, 1100, 110),
    rowWithPlayOrder(5, "held_c", 1, "ponta", "ぽんた", 2, 2, 1300, 130),
    rowWithPlayOrder(5, "held_c", 1, "akane", "あかね", 1, 3, 1500, 150),
  )

  private def row(
      matchNo: Int,
      heldEventId: String,
      matchNoInEvent: Int,
      memberId: String,
      displayName: String,
      rank: Int,
  ): SeriesComparisonMatchPlayerRow =
    rowWithPlayOrder(
      matchNo,
      heldEventId,
      matchNoInEvent,
      memberId,
      displayName,
      rank,
      1,
      1000,
      100
    )

  private def rowWithPlayOrder(
      matchNo: Int,
      heldEventId: String,
      matchNoInEvent: Int,
      memberId: String,
      displayName: String,
      rank: Int,
      playOrder: Int,
      assets: Int,
      revenue: Int,
  ): SeriesComparisonMatchPlayerRow = SeriesComparisonMatchPlayerRow(
    matchId = MatchId.unsafeFromString(s"match-$matchNo"),
    playedAt = now.plusSeconds(matchNo.toLong),
    heldEventId = HeldEventId.unsafeFromString(heldEventId),
    matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNoInEvent),
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
      destination = 0,
      plusStation = 0,
      minusStation = 0,
      cardStation = 0,
      cardShop = 0,
      suriNoGinji = 0,
    ),
  )

  private def assertOptionDouble(actual: Option[Double], expected: Double): Unit = actual match
    case Some(value) =>
      assert(
        math.abs(value - expected) <= DoubleDelta,
        s"expected $expected within $DoubleDelta, got $value",
      )
    case None => fail(s"expected $expected, got None")

  private def metricId(value: String): MetricIdString =
    RefinedTypes.refine[String, MetricKey]("metricId", value).fold(
      error => fail(error),
      identity,
    )

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
