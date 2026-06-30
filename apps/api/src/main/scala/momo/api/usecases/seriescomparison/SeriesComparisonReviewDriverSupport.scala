package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewDriverSupport
    extends SeriesComparisonReviewStatsSupport:

  protected final def selectPrimaryActionDriver(
      drivers: List[ActionDriver]
  ): Option[ActionDriverSelection] =
    val ranked = drivers.map { driver =>
      ActionDriverSelection(
        kind = driver.kind,
        effect = driver.effect,
        effectStrength = math.max(0.0, driver.effect),
        selectionStrength =
          StatsKernel.clamp01(math.max(0.0, driver.effect) * driver.actionability),
        closeToSecond = false,
      )
    }.filter(_.effectStrength > 0.0).sortBy(driver => (-driver.selectionStrength, driver.kind))
    ranked match
      case Nil => None
      case head :: second :: _ => Some(head.copy(closeToSecond =
          head.selectionStrength - second.selectionStrength <= Thresholds.ActionDriverTieDelta
        ))
      case head :: Nil => Some(head)

  protected final def actionDriverStrongEnough(
      driver: ActionDriverSelection,
      status: String
  ): Boolean =
    val minimum =
      if status == "reference" then Thresholds.ReferenceActionDriverEffect
      else Thresholds.MinimumActionDriverEffect
    driver.effectStrength >= minimum

  protected final def destinationPositiveDataReason(
      target: List[SeriesComparisonMatchPlayerRow],
      upper: List[SeriesComparisonMatchPlayerRow],
      lower: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
  ): String =
    val opening =
      s"目的地を取れた試合は${target.size}件で、順位スコアは${decimal(average(target.map(rankScore)))}です。"
    val comparison = driverKind match
      case "accidentAvoidance" =>
        s"入賞試合の事故平均は${decimal(average(upper.map(accidentCount)))}回、下位試合は${decimal(
            average(lower.map(accidentCount))
          )}回で、目的地後の追加事故回避が分岐になっている可能性があります。"
      case "cardShopFollowup" =>
        s"入賞試合のカード売り場平均は${averageEventValue(upper)(_.incidents.cardShop)}、下位試合は${averageEventValue(
            lower
          )(_.incidents.cardShop)}で、目的地後の到着準備が分岐になっている可能性があります。"
      case _ =>
        s"入賞試合の物件収益順位スコア平均は${rankScoreAverage(upper, revenueRankScores)}、下位試合は${rankScoreAverage(
            lower,
            revenueRankScores,
          )}で、目的地後も収益順位を保つ動きが分岐になっている可能性があります。"
    s"$opening $comparison"

  protected final def accidentAnyDataReason(
      score: Double,
      rawSymptom: Double,
      upper: List[SeriesComparisonMatchPlayerRow],
      lower: List[SeriesComparisonMatchPlayerRow],
      driverKind: String,
      revenueRankScores: Map[(String, String), Double],
      destinationRankScores: Map[(String, String), Double],
  ): String =
    val opening =
      s"事故があった試合の順位スコアは${decimal(score)}で、本人平均との差は${signed(rawSymptom)}です。"
    val comparison = driverKind match
      case "destinationRecovery" => s"事故後の入賞試合の目的地順位スコア平均は${rankScoreAverage(
            upper,
            destinationRankScores,
          )}、下位試合は${rankScoreAverage(
            lower,
            destinationRankScores,
          )}で、事故後に目的地順位を戻す動きが分岐になっている可能性があります。"
      case "avoidFurtherMinus" =>
        s"事故後の入賞試合の追加事故平均は${decimal(average(upper.map(minusStationCount)))}回、下位試合は${decimal(
            average(lower.map(minusStationCount))
          )}回で、追加事故を避ける判断が分岐になっている可能性があります。"
      case _ => s"事故後の入賞試合の物件収益順位スコア平均は${rankScoreAverage(
            upper,
            revenueRankScores,
          )}、下位試合は${rankScoreAverage(lower, revenueRankScores)}で、事故後に収益順位を戻す動きが分岐になっている可能性があります。"
    s"$opening $comparison"

  protected final def destinationPositiveDriverEffect(
      rows: List[SeriesComparisonMatchPlayerRow],
      revenueRankScores: Map[(String, String), Double],
      kind: String,
  ): Double =
    val target = rows.filter(_.incidents.destination > 0)
    val upper = target.filter(isUpper)
    val lower = target.filterNot(isUpper)
    kind match
      case "accidentAvoidance" => -StatsKernel.cliffsDelta(
          upper.map(accidentCount),
          lower.map(accidentCount),
        )
      case "cardShopFollowup" => StatsKernel
          .cliffsDelta(upper.map(cardShopCount), lower.map(cardShopCount))
      case _ => StatsKernel.cliffsDelta(
          upper.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
          lower.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        )

  protected final def accidentAnyDriverEffect(
      rows: List[SeriesComparisonMatchPlayerRow],
      revenueRankScores: Map[(String, String), Double],
      destinationRankScores: Map[(String, String), Double],
      kind: String,
  ): Double =
    val target = rows.filter(row => accidentCount(row) > 0)
    val upper = target.filter(isUpper)
    val lower = target.filterNot(isUpper)
    kind match
      case "destinationRecovery" => StatsKernel.cliffsDelta(
          upper.map(row => destinationRankScores.getOrElse(rankKey(row), rankScore(row))),
          lower.map(row => destinationRankScores.getOrElse(rankKey(row), rankScore(row))),
        )
      case "avoidFurtherMinus" => -StatsKernel.cliffsDelta(
          upper.map(minusStationCount),
          lower.map(minusStationCount),
        )
      case _ => StatsKernel.cliffsDelta(
          upper.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
          lower.map(row => revenueRankScores.getOrElse(rankKey(row), rankScore(row))),
        )

  protected final def destinationZeroDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      accidentDelta: Double,
      cardShopDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceView = driver.map(_.kind).getOrElse("revenueRank") match
    case "accidentAvoidance" => evidence(
        "destinationOutcome.accidentAvoidanceContrast",
        "目的地0回時の事故回避差",
        signed(accidentDelta),
        targetCount,
        status,
      )
    case "cardShopRoute" => evidence(
        "destinationOutcome.cardShopContrast",
        "目的地0回時の売り場差",
        signed(cardShopDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "destinationOutcome.revenueRankContrast",
        "目的地0回時の収益順位差",
        signed(revenueRankDelta),
        targetCount,
        status,
      )

  protected final def lowAssetDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      destinationDelta: Double,
      ginjiDelta: Double,
      minusDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceView = driver.map(_.kind).getOrElse("revenueRank") match
    case "destinationShortage" => evidence(
        "assetStyleProfiles.lowAssetDestinationContrast",
        "低資産帯の目的地差",
        signed(destinationDelta),
        targetCount,
        status,
      )
    case "ginjiBias" => evidence(
        "assetStyleProfiles.lowAssetGinjiContrast",
        "低資産帯の銀次差",
        signed(ginjiDelta),
        targetCount,
        status,
      )
    case "minusBias" => evidence(
        "assetStyleProfiles.lowAssetMinusContrast",
        "低資産帯のマイナス駅差",
        signed(minusDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "assetStyleProfiles.lowAssetRevenueRankContrast",
        "低資産帯の収益順位差",
        signed(revenueRankDelta),
        targetCount,
        status,
      )

  protected final def playOrderDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      destinationDelta: Double,
      accidentDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceView = driver.map(_.kind).getOrElse("revenueRank") match
    case "destinationCount" => evidence(
        "playOrder.destinationContrast",
        "得意番手との差: 目的地",
        signed(destinationDelta),
        targetCount,
        status,
      )
    case "accidentAvoidance" => evidence(
        "playOrder.accidentAvoidanceContrast",
        "得意番手との差: 事故回避",
        signed(accidentDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "playOrder.revenueRankContrast",
        "得意番手との差: 収益順位",
        signed(revenueRankDelta),
        targetCount,
        status,
      )

  protected final def ginjiDriverEvidence(
      driver: Option[ActionDriverSelection],
      revenueRankDelta: Double,
      destinationRankDelta: Double,
      accidentDelta: Double,
      targetCount: Int,
      status: String,
  ): SeriesComparisonPlaybookEvidenceView = driver.map(_.kind).getOrElse("revenueRank") match
    case "destinationRank" => evidence(
        "ginji.destinationRankContrast",
        "被害時の目的地順位差",
        signed(destinationRankDelta),
        targetCount,
        status,
      )
    case "accidentAvoidance" => evidence(
        "ginji.accidentAvoidanceContrast",
        "被害時の追加事故回避差",
        signed(accidentDelta),
        targetCount,
        status,
      )
    case _ => evidence(
        "ginji.revenueRankContrast",
        "被害時の収益順位差",
        signed(revenueRankDelta),
        targetCount,
        status,
      )
