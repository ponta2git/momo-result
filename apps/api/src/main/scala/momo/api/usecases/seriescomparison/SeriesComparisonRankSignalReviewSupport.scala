package momo.api.usecases.seriescomparison

import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.engine.*
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] object SeriesComparisonRankSignalReviewSupport:
  private val MaximumCardsPerPlayer = 3

  def appendSecondaryCard(
      memberId: MemberId,
      directCards: List[SeriesComparisonPlaybookCardView],
      analysis: Option[RankAnalysisResult],
  ): List[SeriesComparisonPlaybookCardView] =
    if directCards.isEmpty || directCards.size >= MaximumCardsPerPlayer then directCards
    else
      secondaryCard(memberId, directCards, analysis).fold(directCards)(directCards :+ _)

  private def secondaryCard(
      memberId: MemberId,
      directCards: List[SeriesComparisonPlaybookCardView],
      analysis: Option[RankAnalysisResult],
  ): Option[SeriesComparisonPlaybookCardView] = analysis
    .filter(_.quality == RankAnalysisQuality.Ok)
    .flatMap(result =>
      result.rankSignals.find(_.memberId == memberId).map(signals => result -> signals)
    )
    .flatMap { case (result, playerSignals) =>
      playerSignals.signals
        .filter(signal => signal.stable && signal.importance.isFinite && signal.importance > 0.0)
        .flatMap(signal => reviewCopy(signal).map(copy => (signal, copy)))
        .sortBy { case (signal, copy) => (-signal.importance, copy.category, signal.kind.ordinal) }
        .headOption
        .map { case (signal, copy) =>
          buildCard(memberId, directCards, result, signal, copy)
        }
    }

  private def buildCard(
      memberId: MemberId,
      directCards: List[SeriesComparisonPlaybookCardView],
      result: RankAnalysisResult,
      signal: PlayerRankSignal,
      copy: RankSignalReviewCopy,
  ): SeriesComparisonPlaybookCardView =
    val signalName = copy.signalName
    val direction = directionLabel(signal.direction)
    val score = directCards.map(_.actionAdviceScore).filter(_ > 0.0).minOption
      .map(_ / 2.0).getOrElse(Double.MinPositiveValue)
    SeriesComparisonPlaybookCardView(
      id = s"${memberId.value}.rank-signal-${signalWire(signal.kind)}",
      classification = "verify",
      category = copy.category,
      actionHypothesis = copy.actionHypothesis,
      triggerCondition = copy.triggerCondition,
      recommendedAction = copy.recommendedAction,
      avoidAction = copy.avoidAction,
      dataReason =
        s"開催回を丸ごと外した評価でも、${signalName}は「$direction」という結びつきが安定していました。" +
          s"対象は${result.heldEventCount}開催・${result.matchCount}戦です。これは因果や次戦の勝率ではなく、次の4戦で確かめる補助仮説です。",
      postMatchCheck = copy.postMatchCheck,
      plainReason = copy.plainReason,
      evidenceStrength = "verify",
      targetCount = result.matchCount,
      evidence = List(
        SeriesComparisonPlaybookEvidenceView(
          metricId = s"rankAnalysis.rankSignals.${signalWire(signal.kind)}",
          label = s"${signalName}と順位の結びつき",
          value = direction,
          targetCount = result.matchCount,
          status = "ok",
          method = Some("held_event_permutation_importance"),
          effectEstimate = Some(signal.importance),
          confidenceLow = None,
          confidenceHigh = None,
          stability = Some(1.0),
        ),
        SeriesComparisonPlaybookEvidenceView(
          metricId = "rankAnalysis.modelFit",
          label = "開催回を外した評価",
          value = s"5回中${result.improvedFoldCount}回で基準より良好",
          targetCount = result.matchCount,
          status = "ok",
          method = Some("held_event_cross_validation"),
          effectEstimate = None,
          confidenceLow = None,
          confidenceHigh = None,
          stability = None,
        ),
      ),
      status = "ok",
      anchorTarget = SeriesComparisonPlaybookAnchorTargetView(
        view = "drivers",
        sectionId = "metric-rank-signals",
        label = "順位を読む手掛かり",
      ),
      actionAdviceScore = score,
    )

  private def reviewCopy(signal: PlayerRankSignal): Option[RankSignalReviewCopy] =
    (signal.kind, signal.direction) match
      case (RankSignalKind.Revenue, RankSignalDirection.MoreIsHigher) => Some(
          RankSignalReviewCopy(
            category = "revenue",
            signalName = "物件収益",
            actionHypothesis = "物件収益を保つ進行が順位差につながるか、次の4戦で試す。",
            triggerCondition = "目的地を追いながら、物件収益順位が下がりそうなとき。",
            recommendedAction = "目的地への進行を崩さない範囲で、物件収益順位を2位圏に保つ進行を試す。",
            avoidAction = "この結びつきだけを勝因と決め、目的地や事故の条件を無視すること。",
            postMatchCheck = "次の4戦で物件収益順位と最終順位を並べ、同じ向きが何戦で続いたかを振り返る。",
            plainReason = "開催回をまたいで見ても、物件収益が多い試合ほど上位寄りの関係が続いています。",
          )
        )
      case (RankSignalKind.Destination, RankSignalDirection.MoreIsHigher) => Some(
          RankSignalReviewCopy(
            category = "destination",
            signalName = "目的地到着",
            actionHypothesis = "目的地到着を作る進行が順位差につながるか、次の4戦で試す。",
            triggerCondition = "目的地が遠く、収益作りだけで終盤へ入りそうなとき。",
            recommendedAction = "収益基盤を失わない範囲で、目的地周辺への位置取りと1回到着を試す。",
            avoidAction = "この結びつきだけを勝因と決め、収益や事故の条件を無視すること。",
            postMatchCheck = "次の4戦で目的地回数と最終順位を並べ、同じ向きが何戦で続いたかを振り返る。",
            plainReason = "開催回をまたいで見ても、目的地到着が多い試合ほど上位寄りの関係が続いています。",
          )
        )
      case (RankSignalKind.MinusStation, RankSignalDirection.LessIsHigher) => Some(
          accidentCopy("マイナス駅")
        )
      case (RankSignalKind.Ginji, RankSignalDirection.LessIsHigher) => Some(
          accidentCopy("スリの銀次")
        )
      case _ => None

  private def accidentCopy(signalName: String): RankSignalReviewCopy = RankSignalReviewCopy(
    category = "accident",
    signalName = signalName,
    actionHypothesis = "追加事故を抑える進行が順位差につながるか、次の4戦で試す。",
    triggerCondition = "被害後も一発逆転を急ぎ、さらに事故が重なりそうなとき。",
    recommendedAction = "一発逆転を急ぐ前に、追加事故を避けて2位圏へ戻す進行を試す。",
    avoidAction = "事故の少なさだけを勝因と決め、収益や目的地の条件を無視すること。",
    postMatchCheck = s"次の4戦で${signalName}の回数と最終順位を並べ、同じ向きが何戦で続いたかを振り返る。",
    plainReason = s"開催回をまたいで見ても、${signalName}が少ない試合ほど上位寄りの関係が続いています。",
  )

  private def signalWire(kind: RankSignalKind): String = kind match
    case RankSignalKind.Revenue => "revenue"
    case RankSignalKind.Destination => "destination"
    case RankSignalKind.PlusStation => "plus_station"
    case RankSignalKind.MinusStation => "minus_station"
    case RankSignalKind.CardStation => "card_station"
    case RankSignalKind.CardShop => "card_shop"
    case RankSignalKind.Ginji => "ginji"

  private def directionLabel(direction: RankSignalDirection): String = direction match
    case RankSignalDirection.MoreIsHigher => "多いほど上位寄り"
    case RankSignalDirection.LessIsHigher => "少ないほど上位寄り"

  private final case class RankSignalReviewCopy(
      category: String,
      signalName: String,
      actionHypothesis: String,
      triggerCondition: String,
      recommendedAction: String,
      avoidAction: String,
      postMatchCheck: String,
      plainReason: String,
  )
