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

final class GetSeriesComparisonReviewSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-05-10T12:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title_momotetsu_2")
  private val seasonId = SeasonMasterId.unsafeFromString("season_2026_spring")
  private val mapId = MapMasterId.unsafeFromString("map_japan")
  private val latestHeldEventId = HeldEventId.unsafeFromString("held_latest")
  private val previousHeldEventId = HeldEventId.unsafeFromString("held_previous")
  private val resolvedScope = SeriesComparisonResolvedScope(
    gameTitleId = titleId,
    gameTitleName = "桃鉄2",
    layoutFamily = "momotetsu2",
    scopeKind = "overall",
    scopeId = None,
    scopeName = "総合",
  )

  test("builds deterministic player playbooks"):
    val usecase = GetSeriesComparisonReview[IO](StaticReadModel(Some(resolvedScope), reviewRows))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = assertRight(result)
      assertEquals(response.schemaVersion, 3)
      assertEquals(response.baseline.matchCount, 6)
      assertEquals(response.baseline.playerCount, 4)
      assert(response.commonPlaybookTopics.size <= 2)
      assert(response.commonPlaybookTopics.forall(_.affectedPlayerCount >= 3))
      assert(response.commonPlaybookTopics.forall(_.memberDisplayNames.forall(_.nonEmpty)))

      assertEquals(response.playbookByPlayer.map(_.memberId), List("ponta", "akane", "otaka", "eu"))
      assertEquals(response.playbookByPlayer.map(_.memberDisplayName), List("ぽんた", "あかねまみ", "おーたか", "いーゆー"))
      assert(response.playbookByPlayer.forall(_.cards.size <= 3))
      val cards = response.playbookByPlayer.flatMap(_.cards)
      assert(cards.nonEmpty)
      assert(cards.forall(_.actionAdviceScore > 0.0))
      assert(cards.forall(card =>
        card.actionHypothesis.nonEmpty &&
          card.triggerCondition.nonEmpty &&
          card.recommendedAction.nonEmpty &&
          card.avoidAction.nonEmpty &&
          card.dataReason.nonEmpty &&
          card.postMatchCheck.nonEmpty &&
          card.evidence.nonEmpty
      ))
      assert(cards.forall(card => Set("reproduce", "revise", "verify").contains(card.classification)))
      assert(!cards.exists(_.category == "recent"))
      assert(response.playbookByPlayer.exists(_.cards.exists(_.anchorTarget.view == "drivers")))
      assert(cards.forall(card => Set("drivers", "context").contains(card.anchorTarget.view)))
      assert(cards.exists(_.evidence.exists(_.label == "4人内での目立ち方")))
      val categoryCounts = cards.groupBy(_.category).view.mapValues(_.size).toMap
      assert(categoryCounts.values.forall(_ <= 2))
      val revenueCard = cards.find(_.category == "revenue")
      assertEquals(revenueCard.map(_.actionHypothesis), Some("収益先行時は目的地0回で終えない。"))
      assert(revenueCard.exists(_.evidence.size >= 4))
      assert(revenueCard.exists(_.evidence.exists(_.label == "物件収益トップ時の1位率")))
      assert(revenueCard.exists(_.evidence.exists(_.label == "目的地差の偏り")))
      assert(revenueCard.exists(_.evidence.exists(_.label == "1位率の下振れ込み目安")))
      val visibleTexts = cards.flatMap(card =>
        List(
          card.actionHypothesis,
          card.triggerCondition,
          card.recommendedAction,
          card.avoidAction,
          card.dataReason,
          card.postMatchCheck,
          card.anchorTarget.label,
        ) ++ card.evidence.flatMap(evidence => List(evidence.label, evidence.value))
      )
      assert(!visibleTexts.exists(_.contains("member_")))
      assert(!visibleTexts.exists(_.contains("revenue")))
      assert(!visibleTexts.exists(_.contains("play_order")))
      assert(!visibleTexts.exists(_.contains("destination")))
      assert(!cards.exists(card => card.recommendedAction.matches(""".*(確認|見る|切り分ける)。?$""")))
      assert(response.dataQuality.items.nonEmpty)

  test("summarizes common categories and keeps only peer-distinctive player cards"):
    val usecase = GetSeriesComparisonReview[IO](StaticReadModel(Some(resolvedScope), commonDestinationRows))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = assertRight(result)
      assertEquals(response.commonPlaybookTopics.map(_.category), List("destination"))
      assertEquals(response.commonPlaybookTopics.head.affectedPlayerCount, 3)
      assert(response.commonPlaybookTopics.head.memberDisplayNames.nonEmpty)

      val destinationCards = response.playbookByPlayer.flatMap(_.cards).filter(_.category == "destination")
      assert(destinationCards.nonEmpty)
      assert(destinationCards.size <= 2)
      assert(destinationCards.forall(_.evidence.exists(_.label == "4人内での目立ち方")))

  test("returns an empty review when the selected scope has no confirmed matches"):
    val usecase = GetSeriesComparisonReview[IO](StaticReadModel(Some(resolvedScope), Nil))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId)) yield
      val response = assertRight(result)
      assertEquals(response.baseline.matchCount, 0)
      assertEquals(response.playbookByPlayer, Nil)
      assertEquals(response.dataQuality.items, Nil)

  test("returns not found when the selected scope cannot be resolved"):
    val usecase = GetSeriesComparisonReview[IO](StaticReadModel(None, Nil))

    for result <- usecase.run(SeriesComparisonScope.Overall(titleId))
    yield assertAppError(result, "NOT_FOUND", "series comparison scope was not found")

  private def reviewRows: List[SeriesComparisonMatchPlayerRow] = List(
    matchRows(
      1,
      previousHeldEventId,
      1,
      PlayerRow("ponta", "ぽんた", 1, 1, 7000, 3200, 1, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 6200, 3800, 0, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 4100, 1500, 0, 1),
      PlayerRow("eu", "いーゆー", 4, 4, 2500, 1200, 0, 1),
    ),
    matchRows(
      2,
      previousHeldEventId,
      2,
      PlayerRow("akane", "あかねまみ", 1, 1, 7600, 4200, 1, 0),
      PlayerRow("ponta", "ぽんた", 2, 2, 6800, 3300, 0, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 3600, 1400, 0, 0),
      PlayerRow("eu", "いーゆー", 4, 4, 1800, 1000, 0, 1),
    ),
    matchRows(
      3,
      previousHeldEventId,
      3,
      PlayerRow("ponta", "ぽんた", 1, 1, 8200, 4400, 1, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 6100, 4300, 0, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 3000, 1300, 0, 1),
      PlayerRow("eu", "いーゆー", 4, 4, 1500, 900, 0, 1),
    ),
    matchRows(
      4,
      latestHeldEventId,
      1,
      PlayerRow("ponta", "ぽんた", 1, 1, 8800, 4500, 1, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 6400, 4400, 0, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 3900, 1500, 0, 1),
      PlayerRow("eu", "いーゆー", 4, 4, 2000, 1100, 0, 1),
    ),
    matchRows(
      5,
      latestHeldEventId,
      2,
      PlayerRow("akane", "あかねまみ", 1, 1, 7900, 4600, 1, 0),
      PlayerRow("ponta", "ぽんた", 2, 2, 7200, 3500, 0, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 3400, 1200, 0, 0),
      PlayerRow("eu", "いーゆー", 4, 4, 1700, 900, 0, 0),
    ),
    matchRows(
      6,
      latestHeldEventId,
      3,
      PlayerRow("ponta", "ぽんた", 1, 1, 9000, 4800, 1, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 6900, 4700, 0, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 2800, 1000, 0, 1),
      PlayerRow("eu", "いーゆー", 4, 4, 1200, 700, 0, 1),
    ),
  ).flatten

  private def commonDestinationRows: List[SeriesComparisonMatchPlayerRow] = List(
    matchRows(
      1,
      previousHeldEventId,
      1,
      PlayerRow("eu", "いーゆー", 1, 1, 9000, 3400, 1, 0),
      PlayerRow("ponta", "ぽんた", 2, 2, 6500, 2600, 0, 0),
      PlayerRow("akane", "あかねまみ", 3, 3, 2200, 1800, 0, 1),
      PlayerRow("otaka", "おーたか", 4, 4, 1200, 900, 0, 1),
    ),
    matchRows(
      2,
      previousHeldEventId,
      2,
      PlayerRow("eu", "いーゆー", 1, 1, 8800, 3300, 1, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 6400, 2700, 0, 0),
      PlayerRow("ponta", "ぽんた", 3, 3, 2100, 1700, 0, 1),
      PlayerRow("otaka", "おーたか", 4, 4, 1100, 800, 0, 1),
    ),
    matchRows(
      3,
      previousHeldEventId,
      3,
      PlayerRow("eu", "いーゆー", 1, 1, 8700, 3200, 1, 0),
      PlayerRow("otaka", "おーたか", 2, 2, 6300, 2800, 0, 0),
      PlayerRow("ponta", "ぽんた", 3, 3, 2000, 1600, 0, 1),
      PlayerRow("akane", "あかねまみ", 4, 4, 1000, 700, 0, 1),
    ),
    matchRows(
      4,
      latestHeldEventId,
      1,
      PlayerRow("ponta", "ぽんた", 1, 1, 9000, 4200, 2, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 7800, 3400, 2, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 6200, 3000, 1, 0),
      PlayerRow("eu", "いーゆー", 4, 4, 1800, 900, 0, 0),
    ),
    matchRows(
      5,
      latestHeldEventId,
      2,
      PlayerRow("ponta", "ぽんた", 1, 1, 9200, 4300, 2, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 7900, 3500, 2, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 6300, 3100, 1, 0),
      PlayerRow("eu", "いーゆー", 4, 4, 1600, 850, 0, 0),
    ),
    matchRows(
      6,
      latestHeldEventId,
      3,
      PlayerRow("ponta", "ぽんた", 1, 1, 9400, 4400, 2, 0),
      PlayerRow("akane", "あかねまみ", 2, 2, 8000, 3600, 2, 0),
      PlayerRow("otaka", "おーたか", 3, 3, 6400, 3200, 1, 0),
      PlayerRow("eu", "いーゆー", 4, 4, 1400, 800, 0, 0),
    ),
  ).flatten

  private def matchRows(
      matchNo: Int,
      heldEventId: HeldEventId,
      matchNoInEvent: Int,
      rows: PlayerRow*
  ): List[SeriesComparisonMatchPlayerRow] = rows.map(row =>
    SeriesComparisonMatchPlayerRow(
      matchId = MatchId.unsafeFromString(s"match-$matchNo"),
      playedAt = now.plusSeconds(matchNo.toLong),
      heldEventId = heldEventId,
      matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchNoInEvent),
      gameTitleId = titleId,
      seasonMasterId = seasonId,
      mapMasterId = mapId,
      memberId = MemberId.unsafeFromString(row.memberId),
      memberDisplayName = row.displayName,
      playOrder = PlayOrder.unsafeFromInt(row.playOrder),
      rank = Rank.unsafeFromInt(row.rank),
      totalAssetsManYen = ManYen.unsafeFromInt(row.assets),
      revenueManYen = ManYen.unsafeFromInt(row.revenue),
      incidents = SeriesComparisonIncidentCountsRow(
        destination = row.destination,
        plusStation = 0,
        minusStation = 0,
        cardStation = 0,
        cardShop = 0,
        suriNoGinji = row.ginji,
      ),
    )
  ).toList

  private final case class PlayerRow(
      memberId: String,
      displayName: String,
      playOrder: Int,
      rank: Int,
      assets: Int,
      revenue: Int,
      destination: Int,
      ginji: Int,
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
