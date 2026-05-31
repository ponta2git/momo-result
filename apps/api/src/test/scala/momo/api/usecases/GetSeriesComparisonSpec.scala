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
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel

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
      val response = result.getOrElse(fail(s"expected success, got $result"))
      assertEquals(response.matchCount, 3)
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

      assertEquals(akane.nonRevenue.highRevenueTopCount, 3)
      assertEquals(akane.nonRevenue.highRevenueNoWinCount, 2)
      assertOptionDouble(akane.nonRevenue.highRevenueNoWinRate, 2.0 / 3.0)

      assertEquals(eu.ginji.count, 2)
      assertEquals(eu.ginji.multiEncounterMatchCount, 1)
      assertEquals(eu.ginji.maxInSingleMatch, 2)

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
      assert(response.highlights.exists(_.id == "highlight.destinationIndependent"))
      assert(response.dataQuality.items.exists(item =>
        item.metricId == "ginji.resilienceRankAverage" && item.playerMemberId.contains("ponta") &&
          item.status == "reference"
      ))

  test("returns an empty aggregate when the selected scope has no confirmed matches"):
    val usecase = GetSeriesComparison[IO](StaticReadModel(Some(resolvedScope), Nil))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = result.getOrElse(fail(s"expected success, got $result"))
      assertEquals(response.matchCount, 0)
      assertEquals(response.players, Nil)
      assertEquals(response.metricsByPlayer, Nil)
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
      val response = result.getOrElse(fail(s"expected success, got $result"))
      val expected = List("member_eu", "member_ponta", "member_akane_mami", "member_otaka")
      assertEquals(response.players.map(_.memberId), expected)
      assertEquals(response.metricsByPlayer.map(_.memberId), expected)
      assertEquals(response.trends.rankCumulativeAverage.map(_.memberId), expected)
      assertEquals(response.histograms.assets.series.map(_.memberId), expected)

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

  private def assertAppError[A](
      result: Either[AppError, A],
      expectedCode: String,
      detailContains: String,
  ): Unit = result match
    case Left(error) =>
      assertEquals(error.code, expectedCode)
      assert(error.detail.contains(detailContains), s"unexpected detail: ${error.detail}")
    case Right(value) => fail(s"expected $expectedCode, got success: $value")

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
