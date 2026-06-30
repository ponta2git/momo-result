package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewDataReasonSupport
    extends SeriesComparisonReviewStatsSupport:

  protected final def destinationZeroDataReason(
      targetCount: Int,
      rankScoreDelta: Double,
      upper: List[SeriesComparisonMatchPlayerRow],
      lower: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
  ): String =
    val opening = s"目的地0回の試合は${targetCount}件で、順位スコアは本人平均より${signed(rankScoreDelta)}です。"
    val comparison = driverKind match
      case "accidentAvoidance" =>
        s"上位試合の事故平均は${decimal(average(upper.map(accidentCount)))}回、下位試合は${decimal(
            average(lower.map(accidentCount))
          )}回で、目的地なし展開では追加事故を避ける判断が順位差に効いている可能性があります。"
      case "cardShopRoute" =>
        s"上位試合のカード売り場平均は${averageEventValue(upper)(_.incidents.cardShop)}、下位試合は${averageEventValue(
            lower
          )(_.incidents.cardShop)}で、目的地なし展開では売り場経由で到着準備を作る動きが分岐になっている可能性があります。"
      case _ =>
        s"上位試合の物件収益順位スコア平均は${rankScoreAverage(upper, revenueRankScores)}、下位試合は${rankScoreAverage(
            lower,
            revenueRankScores,
          )}で、目的地なし展開では収益順位を下げないことが分岐になっている可能性があります。"
    s"$opening $comparison"

  protected final def lowAssetDataReason(
      lowRate: Double,
      target: List[SeriesComparisonMatchPlayerRow],
      nonLow: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
  ): String =
    val opening =
      s"選択範囲の低資産帯に入った試合は${percent(lowRate)}で、目安の10.0%より${signedPercent(lowRate - 0.10)}高いです。"
    val comparison = driverKind match
      case "destinationShortage" =>
        s"低資産帯の目的地平均は${averageEventValue(target)(_.incidents.destination)}、それ以外は${averageEventValue(
            nonLow
          )(_.incidents.destination)}で、資産が沈む前の目的地到着が分岐になっている可能性があります。"
      case "ginjiBias" =>
        s"低資産帯の銀次平均は${averageEventValue(target)(_.incidents.suriNoGinji)}、それ以外は${averageEventValue(
            nonLow
          )(_.incidents.suriNoGinji)}で、資産が沈む前の銀次被害後の切り替えが分岐になっている可能性があります。"
      case "minusBias" => s"低資産帯のマイナス駅平均は${averageEventValue(target)(
            _.incidents.minusStation
          )}、それ以外は${averageEventValue(nonLow)(
            _.incidents.minusStation
          )}で、資産が沈む前の追加事故回避が分岐になっている可能性があります。"
      case _ =>
        s"低資産帯の物件収益順位スコア平均は${rankScoreAverage(target, revenueRankScores)}、それ以外は${rankScoreAverage(
            nonLow,
            revenueRankScores,
          )}で、資産が沈む前に収益順位を戻す動きが分岐になっている可能性があります。"
    s"$opening $comparison"

  protected final def playOrderDataReason(
      best: (Int, Double),
      worst: (Int, Double),
      bestRows: List[SeriesComparisonMatchPlayerRow],
      worstRows: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
  ): String =
    val opening = s"得意番手の順位スコアは${decimal(best._2)}、苦手番手は${decimal(worst._2)}で、差は${decimal(
        best._2 - worst._2
      )}です。"
    val comparison = driverKind match
      case "destinationCount" => s"苦手番手の目的地平均は${averageEventValue(worstRows)(
            _.incidents.destination
          )}、得意番手は${averageEventValue(bestRows)(
            _.incidents.destination
          )}で、番手差が出る場面では目的地の遅れが分岐になっている可能性があります。"
      case "accidentAvoidance" =>
        s"苦手番手の事故平均は${decimal(average(worstRows.map(accidentCount)))}回、得意番手は${decimal(
            average(bestRows.map(accidentCount))
          )}回で、番手差が出る場面では事故連鎖を止める判断が分岐になっている可能性があります。"
      case _ => s"苦手番手の物件収益順位スコア平均は${rankScoreAverage(
            worstRows,
            revenueRankScores,
          )}、得意番手は${rankScoreAverage(
            bestRows,
            revenueRankScores,
          )}で、番手差が出る場面では収益順位の遅れが分岐になっている可能性があります。"
    s"$opening $comparison"

  protected final def ginjiDataReason(
      score: Double,
      rawSymptom: Double,
      upper: List[SeriesComparisonMatchPlayerRow],
      lower: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
      destinationRankScores: Map[(String, String), Double],
  ): String =
    val opening = s"銀次被害時の順位スコアは${decimal(score)}で、本人平均との差は${signed(rawSymptom)}です。"
    val comparison = driverKind match
      case "destinationRank" => s"被害時の上位試合の目的地順位スコア平均は${rankScoreAverage(
            upper,
            destinationRankScores,
          )}、下位試合は${rankScoreAverage(
            lower,
            destinationRankScores,
          )}で、被害後も目的地到着で順位圏へ戻す動きが分岐になっている可能性があります。"
      case "accidentAvoidance" =>
        s"被害時の上位試合の追加事故平均は${decimal(average(upper.map(minusStationCount)))}回、下位試合は${decimal(
            average(lower.map(minusStationCount))
          )}回で、被害後に追加事故を避ける判断が分岐になっている可能性があります。"
      case _ => s"被害時の上位試合の物件収益順位スコア平均は${rankScoreAverage(
            upper,
            revenueRankScores,
          )}、下位試合は${rankScoreAverage(lower, revenueRankScores)}で、被害後に収益順位を戻す動きが分岐になっている可能性があります。"
    s"$opening $comparison"

  protected final def recoveryDriverEvidence(
      driver: RecoveryDriver,
      destinationDelta: Double,
      revenueDelta: Double,
      accidentDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceView = driver.kind match
    case "destination" => evidence(
        "momentumSwitch.recoveryDestinationDriver",
        "復帰時の目的地順位差",
        signed(destinationDelta),
        targetCount,
        status,
      )
    case "revenue" => evidence(
        "momentumSwitch.recoveryRevenueDriver",
        "復帰時の収益順位差",
        signed(revenueDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "momentumSwitch.recoveryAccidentDriver",
        "復帰時の事故回避差",
        signed(accidentDelta),
        targetCount,
        status,
      )

  protected final def recoveryDataReason(
      recoveryRate: Double,
      baselinePodiumRate: Double,
      rawSymptom: Double,
      recovered: List[RecoveryTransition],
      lower: List[RecoveryTransition],
      driver: RecoveryDriver,
  ): String =
    val opening = s"前戦下位後の入賞率は${percent(recoveryRate)}で、本人全体の入賞率${percent(
        baselinePodiumRate
      )}との差は${signedPercent(rawSymptom)}です。"
    val comparison = driver.kind match
      case "destination" => s"入賞復帰試合の目的地順位スコア平均は${decimal(
            average(recovered.map(_.destinationRankScore))
          )}、下位継続試合は${decimal(
            average(lower.map(_.destinationRankScore))
          )}で、前戦下位後は目的地到着で2位圏へ戻す動きが分岐になっている可能性があります。"
      case "revenue" => s"入賞復帰試合の物件収益順位スコア平均は${decimal(
            average(recovered.map(_.revenueRankScore))
          )}、下位継続試合は${decimal(
            average(lower.map(_.revenueRankScore))
          )}で、前戦下位後は収益基盤を作り直す動きが分岐になっている可能性があります。"
      case _ => s"入賞復帰試合の事故平均は${decimal(average(recovered.map(_.accidentCount)))}回、下位継続試合は${decimal(
            average(lower.map(_.accidentCount))
          )}回で、前戦下位後は事故後の資産維持が分岐になっている可能性があります。"
    s"$opening $comparison"
