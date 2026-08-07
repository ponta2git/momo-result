package momo.api.usecases.seriescomparison

import munit.FunSuite

import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.engine.*
import momo.api.usecases.seriescomparison.view.*

final class SeriesComparisonRankSignalReviewSupportSpec extends FunSuite:
  private val memberId = MemberId.unsafeFromString("player-a")
  private val otherMemberId = MemberId.unsafeFromString("player-b")

  test("adds the strongest actionable stable signal as a lower-priority verify card"):
    val direct = directCard("direct", score = 0.2)
    val analysis = rankResult(
      RankAnalysisQuality.Ok,
      Vector(
        signal(RankSignalKind.CardShop, RankSignalDirection.MoreIsHigher, 0.9, stable = true),
        signal(RankSignalKind.Revenue, RankSignalDirection.MoreIsHigher, 0.1, stable = true),
        signal(RankSignalKind.Destination, RankSignalDirection.MoreIsHigher, 0.3, stable = true),
      ),
    )

    val cards = SeriesComparisonRankSignalReviewSupport.appendSecondaryCard(
      memberId,
      List(direct),
      Some(analysis),
    )

    assertEquals(cards.head, direct)
    assertEquals(cards.size, 2)
    val secondary = cards.last
    assertEquals(secondary.classification, "verify")
    assertEquals(secondary.category, "destination")
    assert(secondary.actionAdviceScore > 0.0)
    assert(secondary.actionAdviceScore < direct.actionAdviceScore)
    assertEquals(secondary.anchorTarget.sectionId, "metric-rank-signals")
    assertEquals(secondary.evidenceStrength, "verify")
    assert(secondary.evidence.exists(_.method.contains("held_event_permutation_importance")))
    assert(secondary.dataReason.contains("因果や次戦の勝率ではなく"))

  test("requires an existing direct candidate and a free secondary slot"):
    val analysis = rankResult(
      RankAnalysisQuality.Ok,
      Vector(signal(RankSignalKind.Revenue, RankSignalDirection.MoreIsHigher, 0.2, stable = true)),
    )
    val full = List.tabulate(3)(index => directCard(s"direct-$index", score = 0.3 - index * 0.05))

    assertEquals(
      SeriesComparisonRankSignalReviewSupport.appendSecondaryCard(memberId, Nil, Some(analysis)),
      Nil,
    )
    assertEquals(
      SeriesComparisonRankSignalReviewSupport.appendSecondaryCard(memberId, full, Some(analysis)),
      full,
    )

  test("rejects weak, unstable, unsupported, and non-actionable signal directions"):
    val direct = directCard("direct", score = 0.2)
    val rejected = List(
      rankResult(
        RankAnalysisQuality.Reference,
        Vector(signal(
          RankSignalKind.Revenue,
          RankSignalDirection.MoreIsHigher,
          0.2,
          stable = true
        )),
      ),
      rankResult(
        RankAnalysisQuality.Ok,
        Vector(signal(
          RankSignalKind.Revenue,
          RankSignalDirection.MoreIsHigher,
          0.2,
          stable = false
        )),
      ),
      rankResult(
        RankAnalysisQuality.Ok,
        Vector(signal(
          RankSignalKind.Revenue,
          RankSignalDirection.MoreIsHigher,
          0.0,
          stable = true
        )),
      ),
      rankResult(
        RankAnalysisQuality.Ok,
        Vector(signal(
          RankSignalKind.CardStation,
          RankSignalDirection.MoreIsHigher,
          0.4,
          stable = true
        )),
      ),
      rankResult(
        RankAnalysisQuality.Ok,
        Vector(signal(
          RankSignalKind.Revenue,
          RankSignalDirection.LessIsHigher,
          0.4,
          stable = true
        )),
      ),
      rankResult(
        RankAnalysisQuality.Ok,
        Vector(signal(RankSignalKind.Ginji, RankSignalDirection.MoreIsHigher, 0.4, stable = true)),
      ),
    )

    rejected.foreach { analysis =>
      assertEquals(
        SeriesComparisonRankSignalReviewSupport.appendSecondaryCard(
          memberId,
          List(direct),
          Some(analysis),
        ),
        List(direct),
      )
    }

  test("does not use unexpected wins or crown certainty as review inputs"):
    val direct = directCard("direct", score = 0.2)
    val base = rankResult(
      RankAnalysisQuality.Ok,
      Vector(signal(
        RankSignalKind.MinusStation,
        RankSignalDirection.LessIsHigher,
        0.2,
        stable = true
      )),
    )
    val changedTopics = base.copy(
      unexpectedWins = Vector(PlayerUnexpectedWins(memberId, totalWinCount = 99, Vector.empty)),
      crownCertainty = CrownCertainty(
        bootstrapIterations = 999,
        successfulIterations = 999,
        leaderChangeCount = 999,
        shares = Vector(CrownShare(memberId, 0.0), CrownShare(otherMemberId, 1.0)),
      ),
    )

    val first = SeriesComparisonRankSignalReviewSupport.appendSecondaryCard(
      memberId,
      List(direct),
      Some(base),
    )
    val second = SeriesComparisonRankSignalReviewSupport.appendSecondaryCard(
      memberId,
      List(direct),
      Some(changedTopics),
    )

    assertEquals(first, second)
    assertEquals(first.last.category, "accident")

  private def signal(
      kind: RankSignalKind,
      direction: RankSignalDirection,
      importance: Double,
      stable: Boolean,
  ): PlayerRankSignal = PlayerRankSignal(
    kind = kind,
    direction = direction,
    importance = importance,
    foldImportances = Vector.fill(5)(importance),
    foldComparisonCounts = Vector.fill(5)(24),
    stable = stable,
  )

  private def rankResult(
      quality: RankAnalysisQuality,
      signals: Vector[PlayerRankSignal],
  ): RankAnalysisResult = RankAnalysisResult(
    modelVersion = SeriesRankAnalyzer.ModelVersion,
    quality = quality,
    reasons = Vector.empty,
    heldEventCount = 20,
    matchCount = 40,
    improvedFoldCount = 5,
    foldScores = Vector.empty,
    rankSignals = Vector(PlayerRankSignals(memberId, signals)),
    unexpectedWins = Vector(PlayerUnexpectedWins(memberId, totalWinCount = 0, Vector.empty)),
    crownCertainty = CrownCertainty(
      bootstrapIterations = 128,
      successfulIterations = 128,
      leaderChangeCount = 0,
      shares = Vector(CrownShare(memberId, 1.0)),
    ),
  )

  private def directCard(id: String, score: Double): SeriesComparisonPlaybookCardView =
    SeriesComparisonPlaybookCardView(
      id = id,
      classification = "reproduce",
      category = "revenue",
      actionHypothesis = "既存の直接仮説",
      triggerCondition = "既存の発動条件",
      recommendedAction = "既存の行動",
      avoidAction = "既存の注意",
      dataReason = "既存の直接データ",
      postMatchCheck = "既存の確認",
      plainReason = "既存の理由",
      evidenceStrength = "strong",
      targetCount = 12,
      evidence = Nil,
      status = "ok",
      anchorTarget = SeriesComparisonPlaybookAnchorTargetView("drivers", "metric-direct", "直接根拠"),
      actionAdviceScore = score,
    )

end SeriesComparisonRankSignalReviewSupportSpec
