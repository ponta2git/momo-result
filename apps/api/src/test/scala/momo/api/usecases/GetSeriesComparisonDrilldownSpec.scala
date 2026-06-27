package momo.api.usecases

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
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
  private val DoubleDelta = 0.0001

  test("builds rank average history drilldown by match and held event"):
    val usecase = GetSeriesComparisonDrilldown[IO](StaticReadModel(Some(resolvedScope), sampleRows))

    for result <- usecase.run(
        SeriesComparisonScope.Overall(titleId),
        "rank.averageHistory",
        memberId,
      )
    yield
      val response = assertRight(result)
      assertEquals(response.schemaVersion, 1)
      assertEquals(response.metricId, "rank.averageHistory")
      assertEquals(response.player.displayName, "ぽんた")
      assertEquals(response.summary.targetCount, 3)
      assertEquals(response.summary.status, "ok")
      assertOptionDouble(response.summary.currentAverageRank, 7.0 / 3.0)
      assertOptionDouble(response.summary.averageRankDeltaFromFirst, -5.0 / 3.0)
      assertOptionDouble(response.summary.latestHeldEventAverageRankDelta, -2.0 / 3.0)

      assertEquals(response.matchRows.map(_.rank), List(4, 2, 1))
      assertEquals(response.matchRows.map(_.previousRank), List(None, Some(4), Some(2)))
      assertEquals(response.matchRows.map(_.rankDelta), List(None, Some(-2), Some(-1)))
      assertEquals(response.matchRows.map(_.matchNoInEvent), List(1, 2, 1))
      assertOptionDouble(response.matchRows(1).cumulativeAverageRankDelta, -1.0)
      assertOptionDouble(response.matchRows(2).cumulativeAverageRankDelta, -2.0 / 3.0)

      assertEquals(response.heldEventRows.map(_.heldEventId), List("held_a", "held_b"))
      assertEquals(response.heldEventRows.map(_.ranks), List(List(4, 2), List(1)))
      assertEquals(response.heldEventRows.map(_.eventRankDelta), List(Some(-2), None))
      assertEquals(response.heldEventRows.head.cumulativeAverageBefore, None)
      assertOptionDouble(response.heldEventRows(1).cumulativeAverageBefore, 3.0)
      assertOptionDouble(response.heldEventRows(1).cumulativeAverageDelta, -2.0 / 3.0)
      assertEquals(response.dataQuality.items.map(_.status), List("ok"))

  test("returns no target drilldown when player has no rows in scope"):
    val usecase = GetSeriesComparisonDrilldown[IO](StaticReadModel(Some(resolvedScope), sampleRows))

    for result <- usecase.run(
        SeriesComparisonScope.Overall(titleId),
        "rank.averageHistory",
        MemberId.unsafeFromString("absent"),
      )
    yield
      val response = assertRight(result)
      assertEquals(response.summary.status, "no_target")
      assertEquals(response.summary.targetCount, 0)
      assertEquals(response.matchRows, Nil)
      assertEquals(response.heldEventRows, Nil)
      assertEquals(response.dataQuality.items.head.status, "no_target")

  test("returns not found when scope cannot be resolved"):
    val usecase = GetSeriesComparisonDrilldown[IO](StaticReadModel(None, Nil))

    for result <- usecase.run(
        SeriesComparisonScope.Overall(titleId),
        "rank.averageHistory",
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

  private def row(
      matchNo: Int,
      heldEventId: String,
      matchNoInEvent: Int,
      memberId: String,
      displayName: String,
      rank: Int,
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
    playOrder = PlayOrder.unsafeFromInt(1),
    rank = Rank.unsafeFromInt(rank),
    totalAssetsManYen = ManYen.unsafeFromInt(1000),
    revenueManYen = ManYen.unsafeFromInt(100),
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
