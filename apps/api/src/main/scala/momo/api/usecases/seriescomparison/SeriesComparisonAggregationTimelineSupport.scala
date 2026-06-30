package momo.api.usecases.seriescomparison

import cats.syntax.all.*

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonAggregationTimelineSupport
    extends SeriesComparisonAggregationCommonSupport:
  this: SeriesComparisonAggregationAllSupport =>

  protected final def matchNoInEventBreakdown(
      playerOrder: List[MemberId],
      rows: List[SeriesComparisonMatchPlayerRow],
  ): List[MatchNoInEventBreakdownView] = rows.groupBy(_.matchNoInEvent.value).toList
    .sortBy(_._1).map { case (matchNoInEvent, noRows) =>
      MatchNoInEventBreakdownView(
        matchNoInEvent = matchNoInEvent,
        playerRows = playerOrder.map { memberId =>
          val playerRows = sortedPlayerRows(noRows.filter(_.memberId == memberId))
          MatchNoInEventPlayerBreakdownView(
            memberId = memberId.value,
            targetCount = playerRows.size,
            averageRank = average(playerRows.map(row => asDecimal(row.rank.value))),
            podiumRate = rate(playerRows.count(_.rank.value <= 2), playerRows.size),
            status = normalStatus(playerRows.size),
          )
        },
      )
    }

  protected final def matchTimeline(matchGroups: List[MatchGroup]): List[MatchTimelinePointView] =
    val base = matchGroups.map { group =>
      val byRank = group.rows.map(row => row.rank.value -> row).toMap
      val winner = byRank.get(1)
      val second = byRank.get(2)
      val last = byRank.get(4)
      val maxRevenue = group.rows.map(_.revenueManYen.value).maxOption
      TimelineBase(
        group = group,
        gapFirstToSecond = (winner, second)
          .mapN((a, b) => a.totalAssetsManYen.value - b.totalAssetsManYen.value),
        gapFirstToLast = (winner, last)
          .mapN((a, b) => a.totalAssetsManYen.value - b.totalAssetsManYen.value),
        totalGinjiCount = group.rows.map(_.incidents.suriNoGinji).sum,
        revenueTopMemberIds =
          maxRevenue.toList.flatMap(value =>
            group.rows.filter(_.revenueManYen.value == value).map(_.memberId.value)
          ),
        winnerMemberId = winner.map(_.memberId.value),
      )
    }
    val closeThreshold = percentileDouble(
      base.flatMap(_.gapFirstToSecond).sorted,
      Thresholds.TimelineCloseFinishPercentile,
    )
    val blowoutThreshold = percentileDouble(
      base.flatMap(_.gapFirstToLast).sorted,
      Thresholds.TimelineAssetBlowoutPercentile,
    )
    val status =
      if matchGroups.size == 0 then "no_target"
      else if matchGroups.size < Thresholds.MinimumOkSampleSize then "reference"
      else "ok"
    val canUseRelativeFlags = status == "ok"
    base.map { item =>
      val flags = List(
        Option.when(
          item.winnerMemberId.exists(id => !item.revenueTopMemberIds.contains(id))
        )("revenue_top_no_win"),
        Option.when(item.totalGinjiCount >= Thresholds.TimelineGinjiStormMinCount)("ginji_storm"),
        Option.when(
          canUseRelativeFlags && (item.gapFirstToSecond, closeThreshold).mapN(_ <= _)
            .getOrElse(false)
        )("close_finish"),
        Option.when(
          canUseRelativeFlags && (item.gapFirstToLast, blowoutThreshold).mapN(_ >= _)
            .getOrElse(false)
        )("asset_blowout"),
      ).flatten
      MatchTimelinePointView(
        matchIndex = item.group.matchIndex,
        matchId = item.group.matchId.value,
        playedAt = Formatter.format(item.group.playedAt),
        assetGapFirstToSecond = item.gapFirstToSecond,
        assetGapFirstToLast = item.gapFirstToLast,
        totalGinjiCount = item.totalGinjiCount,
        revenueTopMemberIds = item.revenueTopMemberIds,
        winnerMemberId = item.winnerMemberId,
        flags = flags,
        status = status,
      )
    }

  protected val CardShopDestinationKinds = List(
    "destination_with_shop",
    "destination_without_shop",
    "no_destination_with_shop",
    "no_destination_without_shop",
  )

  protected final def cardShopDestination(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): CardShopDestinationView = CardShopDestinationView(playerOrder.map { memberId =>
    val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
    val denominator = rows.size
    val cardShopRows = rows.filter(_.incidents.cardShop > 0)
    val cardShopWithoutDestinationRows = cardShopRows.filter(_.incidents.destination == 0)
    CardShopDestinationPlayerView(
      memberId = memberId.value,
      denominator = denominator,
      cardShopMatchCount = cardShopRows.size,
      cardShopRate = rate(cardShopRows.size, denominator),
      cardShopWithoutDestinationCount = cardShopWithoutDestinationRows.size,
      cardShopWithoutDestinationRate = rate(cardShopWithoutDestinationRows.size, cardShopRows.size),
      quadrants = CardShopDestinationKinds
        .map(kind => cardShopDestinationQuadrant(kind, rows, denominator)),
    )
  })

  protected final def cardShopDestinationQuadrant(
      kind: String,
      rows: List[SeriesComparisonMatchPlayerRow],
      denominator: Int,
  ): CardShopDestinationQuadrantView =
    val targetRows = rows.filter(row =>
      val hasDestination = row.incidents.destination > 0
      val hasCardShop = row.incidents.cardShop > 0
      kind match
        case "destination_with_shop" => hasDestination && hasCardShop
        case "destination_without_shop" => hasDestination && !hasCardShop
        case "no_destination_with_shop" => !hasDestination && hasCardShop
        case _ => !hasDestination && !hasCardShop
    )
    val targetCount = targetRows.size
    CardShopDestinationQuadrantView(
      kind = kind,
      targetCount = targetCount,
      rate = rate(targetCount, denominator),
      averageRank = average(targetRows.map(row => asDecimal(row.rank.value))),
      winRate = rate(targetRows.count(_.rank.value == 1), targetCount),
      podiumRate = rate(targetRows.count(_.rank.value <= 2), targetCount),
      averageAssets = average(targetRows.map(row => asDecimal(row.totalAssetsManYen.value))),
      averageRevenue = average(targetRows.map(row => asDecimal(row.revenueManYen.value))),
      status = conditionalStatus(targetCount),
    )

  protected final case class TimelineBase(
      group: MatchGroup,
      gapFirstToSecond: Option[Int],
      gapFirstToLast: Option[Int],
      totalGinjiCount: Int,
      revenueTopMemberIds: List[String],
      winnerMemberId: Option[String],
  )

  protected final def sortedPlayerRows(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[SeriesComparisonMatchPlayerRow] = rows.sortBy(row =>
    (row.playedAt.toEpochMilli, row.heldEventId.value, row.matchNoInEvent.value, row.matchId.value)
  )

  protected final def suffixStreak(
      rows: List[SeriesComparisonMatchPlayerRow],
      predicate: SeriesComparisonMatchPlayerRow => Boolean,
  ): Int = rows.reverse.takeWhile(predicate).size

  protected final def percentileDouble(
      sortedValues: List[Int],
      probability: Double
  ): Option[Double] =
    StatsKernel.percentile(sortedValues, probability)

  protected final def medianDouble(values: List[Double]): Option[Double] = values.sorted match
    case Nil => None
    case sorted if sorted.size % 2 == 1 => Some(sorted(sorted.size / 2))
    case sorted =>
      val upper = sorted.size / 2
      Some((sorted(upper - 1) + sorted(upper)) / 2.0)
