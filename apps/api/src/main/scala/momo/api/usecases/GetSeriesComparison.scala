package momo.api.usecases

import java.time.format.DateTimeFormatter

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.MemberId
import momo.api.domain.{
  SeriesComparisonMatchPlayerRow, SeriesComparisonResolvedScope, SeriesComparisonScope,
}
import momo.api.endpoints.*
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel

final class GetSeriesComparison[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(scope: SeriesComparisonScope): F[Either[AppError, SeriesComparisonResponse]] = readModel
    .resolveScope(scope).flatMap {
      case None => Monad[F]
          .pure(Left(AppError.NotFound("series comparison scope", scopeKey(scope))))
      case Some(resolved) => readModel.loadRows(resolved)
          .map(rows => Right(SeriesComparisonAggregation.aggregate(resolved, rows)))
    }

  private def scopeKey(scope: SeriesComparisonScope): String = scope.scopeIdValue
    .fold(scope.selectedGameTitleId.value)(id => s"${scope.selectedGameTitleId.value}:$id")

object GetSeriesComparison:
  def apply[F[_]: Monad](readModel: SeriesComparisonReadModel[F]): GetSeriesComparison[F] =
    new GetSeriesComparison(readModel)

private object SeriesComparisonAggregation {
  private object Thresholds:
    val MinimumOkSampleSize = 3
    val MomentumSwitchMinimumOkSampleSize = 8
    val RecentFormWindowSize = 8
    val HistogramLowerPercentile = 0.05
    val HistogramUpperPercentile = 0.95
    val HistogramTargetBinCount = 6
    val StrategyKindMedianDeltaThreshold = 0.0035
    val TimelineCloseFinishPercentile = 0.25
    val TimelineAssetBlowoutPercentile = 0.75
    val TimelineGinjiStormMinCount = 2
    val AssetStyleLowAssetPercentile = 0.10
    val AssetStyleHighAssetPercentile = 0.90
    val AssetStyleBlowoutWinPercentile = 0.75
    val AssetStyleNearMissSecondPercentile = 0.25
    val AssetStyleHeavyLossPercentile = 0.75
    val AssetStyleRateSignalDelta = 0.015
    val AssetStyleLowRiskRateDelta = 0.025
    val AssetStyleSecondRateDelta = 0.07
    val AssetStyleDestinationAverageDelta = 0.08
    val AssetStyleWinMedianAssetsDelta = 10000.0
    val AssetStyleWinMarginDelta = 3000.0
    val AssetStyleLowerGapDelta = 4000.0
    val AssetStyleBlowoutWinRateDelta = 0.025

  private val Formatter = DateTimeFormatter.ISO_INSTANT
  private val DenominatorMetricIds = List(
    "rank.average",
    "rank.distribution",
    "assets.max",
    "assets.min",
    "assets.average",
    "assets.median",
    "assets.histogram",
    "revenue.max",
    "revenue.average",
    "revenue.median",
    "revenue.histogram",
    "podium.rate",
    "lowerHalf.rate",
    "playOrder.assetsDiff",
    "playOrder.revenueDiff",
    "playOrder.assetsIndex",
    "playOrder.revenueIndex",
    "ginji.count",
    "ginji.encounterRate",
    "ginji.multiEncounterMatchCount",
    "ginji.maxInSingleMatch",
    "nonRevenue.rankDelta",
    "destination.conversionDelta",
    "stability.rankStandardDeviation",
    "recentForm.averageRank",
    "recentForm.podiumRate",
    "playerPerformanceProfiles.averageRankScore",
    "playerPerformanceProfiles.averageRevenueAssetRate",
    "assetStyleProfiles.primaryKind",
    "assetStyleProfiles.highAssetRate",
    "assetStyleProfiles.lowAssetRate",
    "assetStyleProfiles.winMedianMargin",
    "matchNoInEventBreakdown.averageRank",
    "matchNoInEventBreakdown.podiumRate",
  )
  private val ConditionalMetricIds = List(
    "ginji.resilienceRankAverage",
    "ginji.resilienceAssetsAverage",
    "ginji.resilienceRevenueAverage",
    "nonRevenue.highRevenueNoWinRate",
    "destination.dependenceScore",
    "revenueOutcome.topWinRate",
    "revenueOutcome.topPodiumRate",
    "revenueOutcome.topLowerHalfRate",
    "revenueOutcome.lowRevenuePodiumRate",
    "destinationOutcome.topWinRate",
    "destinationOutcome.topPodiumRate",
    "destinationOutcome.topLowerHalfRate",
    "destinationOutcome.lowDestinationPodiumRate",
    "destinationOutcome.zeroDestinationPodiumRate",
    "cardShopDestination.destinationWithShop",
    "cardShopDestination.destinationWithoutShop",
    "cardShopDestination.noDestinationWithShop",
    "cardShopDestination.noDestinationWithoutShop",
  )
  private val MomentumSwitchMetricIds = List(
    "momentumSwitch.afterLowerPodiumRate",
    "momentumSwitch.afterFourthPodiumRate",
    "momentumSwitch.afterPodiumLowerRate",
  )
  private val PreferredPlayerOrder =
    Map("member_eu" -> 0, "member_ponta" -> 1, "member_akane_mami" -> 2, "member_otaka" -> 3)

  def aggregate(
      scope: SeriesComparisonResolvedScope,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesComparisonResponse =
    val orderedRows = rows.sortBy(row =>
      (
        row.playedAt.toEpochMilli,
        row.heldEventId.value,
        row.matchNoInEvent.value,
        row.matchId.value,
        row.playOrder.value,
      )
    )
    val matchCount = orderedRows.map(_.matchId).distinct.size
    val rowsByPlayer = orderedRows.groupBy(_.memberId)
    val playerOrder = rowsByPlayer.values.toList.map(_.head).sortBy(playerSortKey).map(_.memberId)
    val matchGroups = orderedRows.groupBy(_.matchId).values.toList.sortBy(groupSortKey).zipWithIndex
      .map { case (rows, index) => MatchGroup(index + 1, rows) }
    val matchIndexById = matchGroups.map(group => group.matchId -> group.matchIndex).toMap
    val players = playerOrder.map { memberId =>
      val first = rowsByPlayer(memberId).head
      SeriesComparisonPlayerResponse(memberId.value, first.memberDisplayName)
    }
    val revenueRanks = rankByMatch(orderedRows, _.revenueManYen.value)
    val assetsRanks = rankByMatch(orderedRows, _.totalAssetsManYen.value)
    val destinationRanks = rankByMatch(orderedRows, _.incidents.destination)
    val assetsHistogram = histogram(
      orderedRows.map(_.totalAssetsManYen.value),
      playerOrder,
      rowsByPlayer,
      row => row.totalAssetsManYen.value,
    )
    val revenueHistogram = histogram(
      orderedRows.map(_.revenueManYen.value),
      playerOrder,
      rowsByPlayer,
      row => row.revenueManYen.value,
    )
    val metrics = playerOrder.map { memberId =>
      val playerRows = rowsByPlayer.getOrElse(memberId, Nil).sortBy(row =>
        (
          row.playedAt.toEpochMilli,
          row.heldEventId.value,
          row.matchNoInEvent.value,
          row.matchId.value,
        )
      )
      memberId.value -> playerMetrics(playerRows, orderedRows, revenueRanks, destinationRanks)
    }.toMap
    val quality =
      dataQuality(playerOrder, rowsByPlayer, orderedRows, revenueRanks, destinationRanks)
    SeriesComparisonResponse(
      schemaVersion = 8,
      scope = SeriesComparisonScopeResponse(
        gameTitleId = scope.gameTitleId.value,
        gameTitleName = scope.gameTitleName,
        layoutFamily = scope.layoutFamily,
        scopeKind = scope.scopeKind,
        scopeId = scope.scopeId,
        scopeName = scope.scopeName,
        seasonMasterId = scope.seasonMasterId.map(_.value),
        seasonName = scope.seasonName,
        mapMasterId = scope.mapMasterId.map(_.value),
        mapName = scope.mapName,
      ),
      matchCount = matchCount,
      players = players,
      metricsByPlayer = playerOrder.map(memberId =>
        SeriesComparisonPlayerMetricsEntry(memberId.value, metrics(memberId.value))
      ),
      trends = trends(playerOrder, rowsByPlayer),
      histograms = SeriesComparisonHistogramsResponse(assetsHistogram, revenueHistogram),
      headToHead = headToHead(playerOrder, orderedRows),
      matchPlayerPoints = matchPlayerPoints(orderedRows, matchIndexById, revenueRanks, assetsRanks),
      recentFormByPlayer = recentFormByPlayer(playerOrder, rowsByPlayer),
      momentumSwitch = momentumSwitchByPlayer(playerOrder, rowsByPlayer),
      playerPerformanceProfiles = playerPerformanceProfiles(playerOrder, rowsByPlayer, metrics),
      assetStyleProfiles = assetStyleProfiles(playerOrder, rowsByPlayer, orderedRows),
      matchNoInEventBreakdown = matchNoInEventBreakdown(playerOrder, orderedRows),
      matchTimeline = matchTimeline(matchGroups),
      cardShopDestination = cardShopDestination(playerOrder, rowsByPlayer),
      playOrderBaselines = playOrderBaselines(orderedRows),
      highlights = highlights(metrics),
      dataQuality = quality,
    )

  private final case class MatchGroup(matchIndex: Int, rows: List[SeriesComparisonMatchPlayerRow]):
    val matchId: momo.api.domain.ids.MatchId = rows.head.matchId
    val playedAt: java.time.Instant = rows.head.playedAt

  private def groupSortKey(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): (Long, String, Int, String) =
    val first = rows.head
    (
      first.playedAt.toEpochMilli,
      first.heldEventId.value,
      first.matchNoInEvent.value,
      first.matchId.value,
    )

  private def playerSortKey(row: SeriesComparisonMatchPlayerRow): (Int, Int, String, String) =
    val preferredOrder = PreferredPlayerOrder.getOrElse(row.memberId.value, Int.MaxValue)
    (
      preferredOrder,
      if preferredOrder == Int.MaxValue then row.playOrder.value else 0,
      row.memberDisplayName,
      row.memberId.value,
    )

  private def playerMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
      destinationRanks: Map[(String, String), Double],
  ): SeriesComparisonPlayerMetricsResponse =
    val denominator = rows.size
    val ranks = rows.map(_.rank.value)
    val assets = rows.map(_.totalAssetsManYen.value)
    val revenue = rows.map(_.revenueManYen.value)
    val podiumCount = ranks.count(r => r == 1 || r == 2)
    val lowerHalfCount = ranks.count(r => r == 3 || r == 4)
    val ginjiRows = rows.filter(_.incidents.suriNoGinji >= 1)
    val highRevenue = highRevenueNoWin(rows, allRows, revenueRanks)
    val destination = destinationMetrics(rows, destinationRanks)
    val revenueOutcome = revenueOutcomeMetrics(rows, allRows, revenueRanks)
    val destinationOutcome = destinationOutcomeMetrics(rows, allRows, destinationRanks)
    SeriesComparisonPlayerMetricsResponse(
      denominator = denominator,
      rank = RankMetricsResponse(
        average = average(ranks.map(asDecimal)),
        distribution = (1 to 4).toList.map { rank =>
          val count = ranks.count(_ == rank)
          RankDistributionResponse(rank, count, rate(count, denominator))
        },
        standardDeviation = stddev(ranks.map(asDecimal)),
      ),
      assets = MoneyDistributionMetricsResponse(
        max = assets.maxOption,
        min = assets.minOption,
        average = average(assets.map(asDecimal)),
        median = median(assets),
      ),
      revenue = RevenueDistributionMetricsResponse(
        max = revenue.maxOption,
        average = average(revenue.map(asDecimal)),
        median = median(revenue),
      ),
      podium = RateCountMetricsResponse(podiumCount, rate(podiumCount, denominator)),
      lowerHalf = RateCountMetricsResponse(lowerHalfCount, rate(lowerHalfCount, denominator)),
      playOrder = playOrderMetrics(rows, allRows),
      ginji = GinjiMetricsResponse(
        count = rows.map(_.incidents.suriNoGinji).sum,
        encounterMatches = ginjiRows.size,
        encounterRate = rate(ginjiRows.size, denominator),
        multiEncounterMatchCount = rows.count(_.incidents.suriNoGinji >= 2),
        maxInSingleMatch = rows.map(_.incidents.suriNoGinji).maxOption.getOrElse(0),
        resilienceRankAverage = average(ginjiRows.map(row => asDecimal(row.rank.value))),
        resilienceAssetsAverage =
          average(ginjiRows.map(row => asDecimal(row.totalAssetsManYen.value))),
        resilienceRevenueAverage = average(ginjiRows.map(row => asDecimal(row.revenueManYen.value))),
      ),
      nonRevenue = highRevenue,
      destination = destination,
      revenueOutcome = revenueOutcome,
      destinationOutcome = destinationOutcome,
      stability = StabilityMetricsResponse(stddev(ranks.map(asDecimal))),
    )

  private def playOrderMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): PlayOrderMetricsResponse =
    def baseline(value: SeriesComparisonMatchPlayerRow => Double): Map[Int, Double] = allRows
      .groupBy(_.playOrder.value).view.mapValues(rs => averageUnsafe(rs.map(value))).toMap
    def diff(value: SeriesComparisonMatchPlayerRow => Double): Option[Double] =
      val base = baseline(value)
      average(rows.flatMap(row => base.get(row.playOrder.value).map(b => value(row) - b)))
    def index(value: SeriesComparisonMatchPlayerRow => Double): Option[Double] =
      val base = baseline(value)
      val values = rows.flatMap { row =>
        base.get(row.playOrder.value).filter(b => b > 0.0 && math.abs(b) >= 1e-9)
          .map(b => value(row) / b)
      }
      if values.size == rows.size then average(values) else None
    PlayOrderMetricsResponse(
      assetsDiff = diff(row => asDecimal(row.totalAssetsManYen.value)),
      revenueDiff = diff(row => asDecimal(row.revenueManYen.value)),
      assetsIndex = index(row => asDecimal(row.totalAssetsManYen.value)),
      revenueIndex = index(row => asDecimal(row.revenueManYen.value)),
      breakdown = playOrderBreakdown(rows),
    )

  private def playOrderBreakdown(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[PlayOrderBreakdownResponse] = (1 to 4).toList.map { playOrder =>
    val targetRows = rows.filter(_.playOrder.value == playOrder)
    PlayOrderBreakdownResponse(
      playOrder = playOrder,
      matchCount = targetRows.size,
      rankAverage = average(targetRows.map(row => asDecimal(row.rank.value))),
      assetsAverage = average(targetRows.map(row => asDecimal(row.totalAssetsManYen.value))),
      revenueAverage = average(targetRows.map(row => asDecimal(row.revenueManYen.value))),
    )
  }

  private def playOrderBaselines(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[PlayOrderBaselineResponse] =
    if rows.isEmpty then Nil
    else
      (1 to 4).toList.map { playOrder =>
        val targetRows = rows.filter(_.playOrder.value == playOrder)
        PlayOrderBaselineResponse(
          playOrder = playOrder,
          assetsAverage = average(targetRows.map(row => asDecimal(row.totalAssetsManYen.value))),
          revenueAverage = average(targetRows.map(row => asDecimal(row.revenueManYen.value))),
          matchCount = targetRows.size,
        )
      }

  private def highRevenueNoWin(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
  ): NonRevenueMetricsResponse =
    val revenueRankValues = rows.flatMap(row => revenueRanks.get(rankKey(row)))
    val rankDelta =
      for
        avgRevenueRank <- average(revenueRankValues)
        avgRank <- average(rows.map(row => asDecimal(row.rank.value)))
      yield avgRevenueRank - avgRank
    val maxRevenueByMatch = allRows.groupBy(_.matchId).view
      .mapValues(rs => rs.map(_.revenueManYen.value).max).toMap
    val topRows = rows
      .filter(row => maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value))
    val noWin = topRows.count(_.rank.value != 1)
    NonRevenueMetricsResponse(
      rankDelta = rankDelta,
      highRevenueNoWinCount = noWin,
      highRevenueTopCount = topRows.size,
      highRevenueNoWinRate = rate(noWin, topRows.size),
    )

  private def destinationMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      destinationRanks: Map[(String, String), Double],
  ): DestinationMetricsResponse =
    val destinationRankValues = rows.flatMap(row => destinationRanks.get(rankKey(row)))
    val conversion =
      for
        avgDestinationRank <- average(destinationRankValues)
        avgRank <- average(rows.map(row => asDecimal(row.rank.value)))
      yield avgDestinationRank - avgRank
    val rankedRows = rows.flatMap(row => destinationRanks.get(rankKey(row)).map(_ -> row))
    val upper = rankedRows.collect { case (r, row) if r < 2.5 => asDecimal(5 - row.rank.value) }
    val lower = rankedRows.collect { case (r, row) if r > 2.5 => asDecimal(5 - row.rank.value) }
    DestinationMetricsResponse(
      conversionDelta = conversion,
      dependenceScore = (average(upper), average(lower)).mapN(_ - _),
      upperTargetCount = upper.size,
      lowerTargetCount = lower.size,
    )

  private def revenueOutcomeMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
  ): RevenueOutcomeMetricsResponse =
    val maxRevenueByMatch = allRows.groupBy(_.matchId).view
      .mapValues(rs => rs.map(_.revenueManYen.value).max).toMap
    val topRows = rows
      .filter(row => maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value))
    val lowRevenueRows = rows.filter(row => revenueRanks.get(rankKey(row)).exists(_ > 2.5))
    RevenueOutcomeMetricsResponse(
      top = conditionalRankOutcome(topRows),
      lowRevenue = conditionalRankOutcome(lowRevenueRows),
      nonTopWinCount = rows.count(row =>
        row.rank.value == 1 && !maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value)
      ),
    )

  private def destinationOutcomeMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      destinationRanks: Map[(String, String), Double],
  ): DestinationOutcomeMetricsResponse =
    val maxDestinationByMatch = allRows.groupBy(_.matchId).view
      .mapValues(rs => rs.map(_.incidents.destination).max).toMap
    val topRows = rows.filter(row =>
      maxDestinationByMatch.get(row.matchId)
        .exists(value => value > 0 && row.incidents.destination == value)
    )
    val lowDestinationRows = rows.filter(row => destinationRanks.get(rankKey(row)).exists(_ > 2.5))
    val zeroDestinationRows = rows.filter(_.incidents.destination == 0)
    DestinationOutcomeMetricsResponse(
      top = conditionalRankOutcome(topRows),
      lowDestination = conditionalRankOutcome(lowDestinationRows),
      zeroDestination = conditionalRankOutcome(zeroDestinationRows),
    )

  private def conditionalRankOutcome(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): ConditionalRankOutcomeResponse =
    val targetCount = rows.size
    val winCount = rows.count(_.rank.value == 1)
    val podiumCount = rows.count(_.rank.value <= 2)
    val lowerHalfCount = rows.count(_.rank.value >= 3)
    ConditionalRankOutcomeResponse(
      targetCount = targetCount,
      winCount = winCount,
      winRate = rate(winCount, targetCount),
      podiumCount = podiumCount,
      podiumRate = rate(podiumCount, targetCount),
      lowerHalfCount = lowerHalfCount,
      lowerHalfRate = rate(lowerHalfCount, targetCount),
      rankDistribution = (1 to 4).toList.map { rank =>
        val count = rows.count(_.rank.value == rank)
        RankDistributionResponse(rank, count, rate(count, targetCount))
      },
      status = conditionalStatus(targetCount),
    )

  private def trends(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): SeriesComparisonTrendsResponse =
    def series(value: (SeriesComparisonMatchPlayerRow, Int) => Double): List[TrendSeriesResponse] =
      playerOrder.map { memberId =>
        val rows = rowsByPlayer.getOrElse(memberId, Nil).sortBy(row =>
          (
            row.playedAt.toEpochMilli,
            row.heldEventId.value,
            row.matchNoInEvent.value,
            row.matchId.value,
          )
        )
        TrendSeriesResponse(
          memberId = memberId.value,
          points = rows.zipWithIndex.map { case (row, idx) =>
            TrendPointResponse(
              index = idx + 1,
              matchId = row.matchId.value,
              playedAt = Formatter.format(row.playedAt),
              value = Some(value(row, idx + 1)),
            )
          },
        )
      }
    SeriesComparisonTrendsResponse(
      rankCumulativeAverage = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        averageUnsafe(rows.map(row => asDecimal(row.rank.value)))
      },
      rankCumulativeStandardDeviation = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        stddev(rows.map(row => asDecimal(row.rank.value))).getOrElse(0.0)
      },
      podiumCumulativeRate = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        asDecimal(rows.count(r => r.rank.value <= 2)) / asDecimal(idx)
      },
      lowerHalfCumulativeRate = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        asDecimal(rows.count(r => r.rank.value >= 3)) / asDecimal(idx)
      },
      ginjiCumulativeCount = series { (row, idx) =>
        asDecimal(rowsByPlayer(row.memberId).take(idx).map(_.incidents.suriNoGinji).sum)
      },
    )

  private def headToHead(
      playerOrder: List[MemberId],
      rows: List[SeriesComparisonMatchPlayerRow],
  ): HeadToHeadResponse =
    val rowsByMatchAndPlayer = rows.map(row => (row.matchId, row.memberId) -> row).toMap
    HeadToHeadResponse(entries = playerOrder.flatMap { subjectId =>
      playerOrder.map { opponentId =>
        if subjectId == opponentId then
          HeadToHeadEntryResponse(
            subjectMemberId = subjectId.value,
            opponentMemberId = opponentId.value,
            matchCount = 0,
            betterRankCount = 0,
            betterRankRate = None,
            averageRankDiff = None,
            averageAssetsDiff = None,
            status = "self",
          )
        else
          val pairs = rows.filter(_.memberId == subjectId).flatMap(subject =>
            rowsByMatchAndPlayer.get((subject.matchId, opponentId))
              .map(opponent => subject -> opponent)
          )
          val matchCount = pairs.size
          val betterRankCount = pairs.count { case (subject, opponent) =>
            subject.rank.value < opponent.rank.value
          }
          HeadToHeadEntryResponse(
            subjectMemberId = subjectId.value,
            opponentMemberId = opponentId.value,
            matchCount = matchCount,
            betterRankCount = betterRankCount,
            betterRankRate = rate(betterRankCount, matchCount),
            averageRankDiff = average(pairs.map { case (subject, opponent) =>
              asDecimal(opponent.rank.value - subject.rank.value)
            }),
            averageAssetsDiff = average(pairs.map { case (subject, opponent) =>
              asDecimal(subject.totalAssetsManYen.value - opponent.totalAssetsManYen.value)
            }),
            status = normalStatus(matchCount),
          )
      }
    })

  private def matchPlayerPoints(
      rows: List[SeriesComparisonMatchPlayerRow],
      matchIndexById: Map[momo.api.domain.ids.MatchId, Int],
      revenueRanks: Map[(String, String), Double],
      assetsRanks: Map[(String, String), Double],
  ): List[MatchPlayerPointResponse] = rows.map(row =>
    MatchPlayerPointResponse(
      matchIndex = matchIndexById.getOrElse(row.matchId, 0),
      matchId = row.matchId.value,
      playedAt = Formatter.format(row.playedAt),
      memberId = row.memberId.value,
      rank = row.rank.value,
      totalAssets = row.totalAssetsManYen.value,
      revenue = row.revenueManYen.value,
      revenueAssetRate = revenueAssetRate(row),
      assetsRank = assetsRanks.getOrElse(rankKey(row), 0.0),
      revenueRank = revenueRanks.getOrElse(rankKey(row), 0.0),
    )
  )

  private def recentFormByPlayer(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): List[RecentFormPlayerResponse] =
    val windowSize = Thresholds.RecentFormWindowSize
    playerOrder.map { memberId =>
      val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
      val recent = rows.takeRight(windowSize)
      RecentFormPlayerResponse(
        memberId = memberId.value,
        windowSize = windowSize,
        targetCount = recent.size,
        averageRank = average(recent.map(row => asDecimal(row.rank.value))),
        podiumRate = rate(recent.count(_.rank.value <= 2), recent.size),
        winStreak = suffixStreak(rows, _.rank.value == 1),
        podiumStreak = suffixStreak(rows, _.rank.value <= 2),
        lowerHalfStreak = suffixStreak(rows, _.rank.value >= 3),
        status = normalStatus(recent.size),
      )
    }

  private def momentumSwitchByPlayer(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): MomentumSwitchResponse = MomentumSwitchResponse(playerOrder.map { memberId =>
    val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
    val transitions = rankTransitions(rows)
    val podiumBaseline = rate(rows.count(_.rank.value <= 2), rows.size)
    val lowerHalfBaseline = rate(rows.count(_.rank.value >= 3), rows.size)
    MomentumSwitchPlayerResponse(
      memberId = memberId.value,
      denominator = rows.size,
      transitionCount = transitions.size,
      afterLower = momentumSwitchRate(
        transitions,
        previousMatches = _.rank.value >= 3,
        currentMatches = _.rank.value <= 2,
        baselineRate = podiumBaseline,
      ),
      afterFourth = momentumSwitchRate(
        transitions,
        previousMatches = _.rank.value == 4,
        currentMatches = _.rank.value <= 2,
        baselineRate = podiumBaseline,
      ),
      afterPodium = momentumSwitchRate(
        transitions,
        previousMatches = _.rank.value <= 2,
        currentMatches = _.rank.value >= 3,
        baselineRate = lowerHalfBaseline,
      ),
      transitionRows = momentumSwitchTransitionRows(transitions),
    )
  })

  private def momentumSwitchRate(
      transitions: List[RankTransition],
      previousMatches: SeriesComparisonMatchPlayerRow => Boolean,
      currentMatches: SeriesComparisonMatchPlayerRow => Boolean,
      baselineRate: Option[Double],
  ): MomentumSwitchRateResponse =
    val targets = transitions.filter(transition => previousMatches(transition.previous))
    val successCount = targets.count(transition => currentMatches(transition.current))
    val switchRate = rate(successCount, targets.size)
    MomentumSwitchRateResponse(
      targetCount = targets.size,
      successCount = successCount,
      rate = switchRate,
      baselineRate = baselineRate,
      deltaFromBaseline = (switchRate, baselineRate).mapN(_ - _),
      status = momentumSwitchStatus(targets.size),
    )

  private def momentumSwitchTransitionRows(
      transitions: List[RankTransition]
  ): List[MomentumSwitchTransitionRowResponse] = (1 to 4).toList.map { previousRank =>
    val targets = transitions.filter(_.previous.rank.value == previousRank)
    val targetCount = targets.size
    MomentumSwitchTransitionRowResponse(
      previousRank = previousRank,
      targetCount = targetCount,
      status = momentumSwitchStatus(targetCount),
      cells = (1 to 4).toList.map { nextRank =>
        val count = targets.count(_.current.rank.value == nextRank)
        MomentumSwitchTransitionCellResponse(
          nextRank = nextRank,
          count = count,
          rate = rate(count, targetCount),
        )
      },
    )
  }

  private final case class RankTransition(
      previous: SeriesComparisonMatchPlayerRow,
      current: SeriesComparisonMatchPlayerRow,
  )

  private def rankTransitions(rows: List[SeriesComparisonMatchPlayerRow]): List[RankTransition] =
    rows.sliding(2).collect { case List(previous, current) => RankTransition(previous, current) }
      .toList

  private def playerPerformanceProfiles(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      metrics: Map[String, SeriesComparisonPlayerMetricsResponse],
  ): PlayerPerformanceProfilesResponse =
    val entriesBase = playerOrder.map { memberId =>
      val rows = rowsByPlayer.getOrElse(memberId, Nil)
      val rankScore = average(rows.map(row => asDecimal(5 - row.rank.value)))
      val revenueAssetRates = rows.flatMap(revenueAssetRate)
      val m = metrics.get(memberId.value)
      ProfileBase(
        memberId = memberId,
        rankStandardDeviation = m.flatMap(_.stability.rankStandardDeviation),
        podiumRate = m.flatMap(_.podium.rate),
        averageRankScore = rankScore,
        averageRevenueAssetRate = average(revenueAssetRates),
        status = normalStatus(rows.size),
      )
    }
    val riskMedian = medianDouble(entriesBase.flatMap(_.rankStandardDeviation))
    val returnMedian = medianDouble(entriesBase.flatMap(_.averageRankScore))
    val revenueAssetRateMedian = medianDouble(entriesBase.flatMap(_.averageRevenueAssetRate))
    PlayerPerformanceProfilesResponse(
      rankStandardDeviationMedian = riskMedian,
      averageRankScoreMedian = returnMedian,
      averageRevenueAssetRateMedian = revenueAssetRateMedian,
      entries = entriesBase.map { entry =>
        val kind = (entry.rankStandardDeviation, entry.averageRankScore, riskMedian, returnMedian)
          .mapN { (x, y, xMedian, yMedian) =>
            if x <= xMedian && y >= yMedian then "steady_leader"
            else if x > xMedian && y >= yMedian then "swing_leader"
            else if x <= xMedian && y < yMedian then "steady_chaser"
            else "swing_chaser"
          }
        PlayerPerformanceProfileResponse(
          memberId = entry.memberId.value,
          rankStandardDeviation = entry.rankStandardDeviation,
          podiumRate = entry.podiumRate,
          averageRankScore = entry.averageRankScore,
          averageRevenueAssetRate = entry.averageRevenueAssetRate,
          profileKind = kind,
          strategyKind = strategyKind(entry, entriesBase),
          status = entry.status,
        )
      },
    )

  private final case class ProfileBase(
      memberId: MemberId,
      rankStandardDeviation: Option[Double],
      podiumRate: Option[Double],
      averageRankScore: Option[Double],
      averageRevenueAssetRate: Option[Double],
      status: String,
  )

  private def assetStyleProfiles(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): AssetStyleProfilesResponse =
    val matchRows = allRows.groupBy(_.matchId)
    val firstAssetsByMatch = assetsByRank(matchRows, 1)
    val secondAssetsByMatch = assetsByRank(matchRows, 2)
    val lowAssetThreshold = percentileDouble(
      allRows.map(_.totalAssetsManYen.value).sorted,
      Thresholds.AssetStyleLowAssetPercentile,
    )
    val highAssetThreshold = percentileDouble(
      allRows.map(_.totalAssetsManYen.value).sorted,
      Thresholds.AssetStyleHighAssetPercentile,
    )
    val winMargins = allRows.flatMap(row =>
      Option.when(row.rank.value == 1)(
        row.totalAssetsManYen.value -
          secondAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value)
      )
    )
    val secondGaps = allRows.flatMap(row =>
      Option.when(row.rank.value == 2)(
        firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
          row.totalAssetsManYen.value
      )
    )
    val lowerGaps = allRows.flatMap(row =>
      Option.when(row.rank.value >= 3)(
        firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
          row.totalAssetsManYen.value
      )
    )
    val blowoutWinThreshold =
      percentileDouble(winMargins.sorted, Thresholds.AssetStyleBlowoutWinPercentile)
    val nearMissSecondThreshold =
      percentileDouble(secondGaps.sorted, Thresholds.AssetStyleNearMissSecondPercentile)
    val heavyLossThreshold =
      percentileDouble(lowerGaps.sorted, Thresholds.AssetStyleHeavyLossPercentile)
    val bases = playerOrder.map { memberId =>
      val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
      assetStyleBase(
        memberId,
        rows,
        firstAssetsByMatch,
        secondAssetsByMatch,
        lowAssetThreshold,
        highAssetThreshold,
        blowoutWinThreshold,
        nearMissSecondThreshold,
        heavyLossThreshold,
      )
    }
    val medians = assetStyleMedians(bases)
    AssetStyleProfilesResponse(
      lowAssetThreshold = lowAssetThreshold.map(value => math.round(value).toInt),
      highAssetThreshold = highAssetThreshold.map(value => math.round(value).toInt),
      blowoutWinThreshold = blowoutWinThreshold.map(value => math.round(value).toInt),
      nearMissSecondThreshold = nearMissSecondThreshold.map(value => math.round(value).toInt),
      heavyLossThreshold = heavyLossThreshold.map(value => math.round(value).toInt),
      entries = bases.map { base =>
        val shapeKind = assetStyleShapeKind(base, medians)
        val tags = assetStyleTags(base, medians, shapeKind)
        AssetStyleProfileResponse(
          memberId = base.memberId.value,
          targetCount = base.targetCount,
          primaryKind = assetStylePrimaryKind(base, medians),
          secondaryKind = tags.headOption,
          shapeKind = shapeKind,
          tags = tags,
          metrics = base.metrics,
          status = base.status,
        )
      },
    )

  private def assetsByRank(
      matchRows: Map[momo.api.domain.ids.MatchId, List[SeriesComparisonMatchPlayerRow]],
      rank: Int,
  ): Map[momo.api.domain.ids.MatchId, Int] = matchRows.view.flatMap { case (matchId, rows) =>
    rows.find(_.rank.value == rank).map(row => matchId -> row.totalAssetsManYen.value)
  }.toMap

  private def assetStyleBase(
      memberId: MemberId,
      rows: List[SeriesComparisonMatchPlayerRow],
      firstAssetsByMatch: Map[momo.api.domain.ids.MatchId, Int],
      secondAssetsByMatch: Map[momo.api.domain.ids.MatchId, Int],
      lowAssetThreshold: Option[Double],
      highAssetThreshold: Option[Double],
      blowoutWinThreshold: Option[Double],
      nearMissSecondThreshold: Option[Double],
      heavyLossThreshold: Option[Double],
  ): AssetStyleProfileBase =
    val targetCount = rows.size
    val assets = rows.map(_.totalAssetsManYen.value)
    val winRows = rows.filter(_.rank.value == 1)
    val secondRows = rows.filter(_.rank.value == 2)
    val lowerRows = rows.filter(_.rank.value >= 3)
    val winMargins = winRows.map(row =>
      row.totalAssetsManYen.value -
        secondAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value)
    )
    val secondGaps = secondRows.map(row =>
      firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
        row.totalAssetsManYen.value
    )
    val lowerGaps = lowerRows.map(row =>
      firstAssetsByMatch.getOrElse(row.matchId, row.totalAssetsManYen.value) -
        row.totalAssetsManYen.value
    )
    val highAssetCount = highAssetThreshold
      .fold(0)(threshold => assets.count(value => asDecimal(value) >= threshold))
    val lowAssetCount = lowAssetThreshold
      .fold(0)(threshold => assets.count(value => asDecimal(value) <= threshold))
    val blowoutWinCount = blowoutWinThreshold
      .fold(0)(threshold => winMargins.count(value => asDecimal(value) >= threshold))
    val nearMissSecondCount = nearMissSecondThreshold
      .fold(0)(threshold => secondGaps.count(value => asDecimal(value) <= threshold))
    val heavyLossCount = heavyLossThreshold
      .fold(0)(threshold => lowerGaps.count(value => asDecimal(value) >= threshold))
    val destinationPositiveCount = rows.count(_.incidents.destination > 0)
    val metrics = AssetStyleMetricsResponse(
      p10Assets = percentileDouble(assets.sorted, 0.10),
      medianAssets = median(assets),
      p90Assets = percentileDouble(assets.sorted, 0.90),
      p90P10Spread = (percentileDouble(assets.sorted, 0.90), percentileDouble(assets.sorted, 0.10))
        .mapN(_ - _),
      highAssetCount = highAssetCount,
      highAssetRate = rate(highAssetCount, targetCount),
      lowAssetCount = lowAssetCount,
      lowAssetRate = rate(lowAssetCount, targetCount),
      winCount = winRows.size,
      winRate = rate(winRows.size, targetCount),
      podiumRate = rate(rows.count(_.rank.value <= 2), targetCount),
      secondCount = secondRows.size,
      secondRate = rate(secondRows.size, targetCount),
      lowerHalfRate = rate(lowerRows.size, targetCount),
      winMedianAssets = median(winRows.map(_.totalAssetsManYen.value)),
      winMedianMargin = median(winMargins),
      secondMedianGap = median(secondGaps),
      lowerHalfMedianGap = median(lowerGaps),
      blowoutWinCount = blowoutWinCount,
      nearMissSecondCount = nearMissSecondCount,
      heavyLossCount = heavyLossCount,
      averageRevenueAssetRate = average(rows.flatMap(revenueAssetRate)),
      destinationAverage = average(rows.map(row => asDecimal(row.incidents.destination))),
      destinationPositiveRate = rate(destinationPositiveCount, targetCount),
    )
    AssetStyleProfileBase(
      memberId = memberId,
      targetCount = targetCount,
      metrics = metrics,
      status = normalStatus(targetCount),
    )

  private final case class AssetStyleProfileBase(
      memberId: MemberId,
      targetCount: Int,
      metrics: AssetStyleMetricsResponse,
      status: String,
  )

  private final case class AssetStyleMedians(
      highAssetRate: Option[Double],
      lowAssetRate: Option[Double],
      winRate: Option[Double],
      podiumRate: Option[Double],
      secondRate: Option[Double],
      blowoutWinRate: Option[Double],
      winMedianAssets: Option[Double],
      winMedianMargin: Option[Double],
      lowerHalfMedianGap: Option[Double],
      averageRevenueAssetRate: Option[Double],
      destinationAverage: Option[Double],
  )

  private def assetStyleMedians(bases: List[AssetStyleProfileBase]): AssetStyleMedians =
    def medianOf(value: AssetStyleMetricsResponse => Option[Double]): Option[Double] =
      medianDouble(bases.flatMap(base => value(base.metrics)))
    def medianOfBase(value: AssetStyleProfileBase => Option[Double]): Option[Double] =
      medianDouble(bases.flatMap(value))
    AssetStyleMedians(
      highAssetRate = medianOf(_.highAssetRate),
      lowAssetRate = medianOf(_.lowAssetRate),
      winRate = medianOf(_.winRate),
      podiumRate = medianOf(_.podiumRate),
      secondRate = medianOf(_.secondRate),
      blowoutWinRate = medianOfBase(base => blowoutWinRate(base.metrics, base.targetCount)),
      winMedianAssets = medianOf(_.winMedianAssets),
      winMedianMargin = medianOf(_.winMedianMargin),
      lowerHalfMedianGap = medianOf(_.lowerHalfMedianGap),
      averageRevenueAssetRate = medianOf(_.averageRevenueAssetRate),
      destinationAverage = medianOf(_.destinationAverage),
    )

  private def assetStylePrimaryKind(
      base: AssetStyleProfileBase,
      medians: AssetStyleMedians,
  ): Option[String] =
    if base.targetCount == 0 then None
    else
      val metrics = base.metrics
      val explosionSignalCount = List(
        above(metrics.highAssetRate, medians.highAssetRate, Thresholds.AssetStyleRateSignalDelta),
        above(
          blowoutWinRate(metrics, base.targetCount),
          medians.blowoutWinRate,
          Thresholds.AssetStyleBlowoutWinRateDelta,
        ),
        above(
          metrics.winMedianAssets,
          medians.winMedianAssets,
          Thresholds.AssetStyleWinMedianAssetsDelta,
        ),
      ).count(identity)
      if explosionSignalCount >= 2 then Some("asset_explosion")
      else if above(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        ) &&
        (atLeast(metrics.winRate, medians.winRate) || above(
          metrics.lowerHalfMedianGap,
          medians.lowerHalfMedianGap,
          Thresholds.AssetStyleLowerGapDelta,
        ))
      then Some("high_risk_breakthrough")
      else if below(
          blowoutWinRate(metrics, base.targetCount),
          medians.blowoutWinRate,
          Thresholds.AssetStyleBlowoutWinRateDelta,
        ) ||
        below(metrics.winMedianMargin, medians.winMedianMargin, Thresholds.AssetStyleWinMarginDelta)
      then Some("close_collector")
      else if below(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleLowRiskRateDelta,
        ) && atLeast(metrics.podiumRate, medians.podiumRate)
      then Some("steady_accumulator")
      else if above(metrics.secondRate, medians.secondRate, Thresholds.AssetStyleSecondRateDelta)
      then Some("upper_chaser")
      else Some("balanced")

  private def assetStyleShapeKind(
      base: AssetStyleProfileBase,
      medians: AssetStyleMedians,
  ): Option[String] =
    if base.targetCount == 0 then None
    else
      val metrics = base.metrics
      if above(
          metrics.highAssetRate,
          medians.highAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        ) && above(metrics.lowAssetRate, medians.lowAssetRate, 0.010)
      then Some("two_tailed")
      else if below(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleLowRiskRateDelta,
        ) && atLeast(metrics.highAssetRate, medians.highAssetRate)
      then Some("upper_side")
      else if above(
          metrics.lowAssetRate,
          medians.lowAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        ) && atMost(metrics.highAssetRate, medians.highAssetRate)
      then Some("lower_tail")
      else if below(
          metrics.highAssetRate,
          medians.highAssetRate,
          Thresholds.AssetStyleLowRiskRateDelta,
        )
      then Some("thin_right_tail")
      else if above(
          metrics.highAssetRate,
          medians.highAssetRate,
          Thresholds.AssetStyleRateSignalDelta,
        )
      then Some("right_tail")
      else Some("middle_heavy")

  private def assetStyleTags(
      base: AssetStyleProfileBase,
      medians: AssetStyleMedians,
      shapeKind: Option[String],
  ): List[String] =
    val metrics = base.metrics
    List(
      Option.when(shapeKind.contains("two_tailed"))("high_variance"),
      Option.when(above(
        metrics.destinationAverage,
        medians.destinationAverage,
        Thresholds.AssetStyleDestinationAverageDelta,
      ))("mobility_collecting"),
      Option.when(
        above(metrics.secondRate, medians.secondRate, Thresholds.AssetStyleSecondRateDelta)
      )("upper_chaser"),
      Option.when(above(
        metrics.averageRevenueAssetRate,
        medians.averageRevenueAssetRate,
        Thresholds.StrategyKindMedianDeltaThreshold,
      ))("property_base"),
      Option.when(
        above(metrics.lowAssetRate, medians.lowAssetRate, Thresholds.AssetStyleRateSignalDelta)
      )("downside_risk"),
      Option.when(below(
        metrics.averageRevenueAssetRate,
        medians.averageRevenueAssetRate,
        Thresholds.StrategyKindMedianDeltaThreshold,
      ))("card_base"),
      Option.when(
        below(metrics.winMedianMargin, medians.winMedianMargin, Thresholds.AssetStyleWinMarginDelta)
      )("close_finish"),
    ).flatten.distinct

  private def blowoutWinRate(metrics: AssetStyleMetricsResponse, targetCount: Int): Option[Double] =
    rate(metrics.blowoutWinCount, targetCount)

  private def above(value: Option[Double], baseline: Option[Double], delta: Double): Boolean =
    (value, baseline).mapN((v, b) => v >= b + delta).getOrElse(false)

  private def below(value: Option[Double], baseline: Option[Double], delta: Double): Boolean =
    (value, baseline).mapN((v, b) => v <= b - delta).getOrElse(false)

  private def atLeast(value: Option[Double], baseline: Option[Double]): Boolean = (value, baseline)
    .mapN(_ >= _).getOrElse(false)

  private def atMost(value: Option[Double], baseline: Option[Double]): Boolean = (value, baseline)
    .mapN(_ <= _).getOrElse(false)

  private def matchNoInEventBreakdown(
      playerOrder: List[MemberId],
      rows: List[SeriesComparisonMatchPlayerRow],
  ): List[MatchNoInEventBreakdownResponse] = rows.groupBy(_.matchNoInEvent.value).toList
    .sortBy(_._1).map { case (matchNoInEvent, noRows) =>
      MatchNoInEventBreakdownResponse(
        matchNoInEvent = matchNoInEvent,
        playerRows = playerOrder.map { memberId =>
          val playerRows = sortedPlayerRows(noRows.filter(_.memberId == memberId))
          MatchNoInEventPlayerBreakdownResponse(
            memberId = memberId.value,
            targetCount = playerRows.size,
            averageRank = average(playerRows.map(row => asDecimal(row.rank.value))),
            podiumRate = rate(playerRows.count(_.rank.value <= 2), playerRows.size),
            status = normalStatus(playerRows.size),
          )
        },
      )
    }

  private def matchTimeline(matchGroups: List[MatchGroup]): List[MatchTimelinePointResponse] =
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
      MatchTimelinePointResponse(
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

  private val CardShopDestinationKinds = List(
    "destination_with_shop",
    "destination_without_shop",
    "no_destination_with_shop",
    "no_destination_without_shop",
  )

  private def cardShopDestination(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): CardShopDestinationResponse = CardShopDestinationResponse(playerOrder.map { memberId =>
    val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
    val denominator = rows.size
    val cardShopRows = rows.filter(_.incidents.cardShop > 0)
    val cardShopWithoutDestinationRows = cardShopRows.filter(_.incidents.destination == 0)
    CardShopDestinationPlayerResponse(
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

  private def cardShopDestinationQuadrant(
      kind: String,
      rows: List[SeriesComparisonMatchPlayerRow],
      denominator: Int,
  ): CardShopDestinationQuadrantResponse =
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
    CardShopDestinationQuadrantResponse(
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

  private final case class TimelineBase(
      group: MatchGroup,
      gapFirstToSecond: Option[Int],
      gapFirstToLast: Option[Int],
      totalGinjiCount: Int,
      revenueTopMemberIds: List[String],
      winnerMemberId: Option[String],
  )

  private def sortedPlayerRows(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): List[SeriesComparisonMatchPlayerRow] = rows.sortBy(row =>
    (row.playedAt.toEpochMilli, row.heldEventId.value, row.matchNoInEvent.value, row.matchId.value)
  )

  private def suffixStreak(
      rows: List[SeriesComparisonMatchPlayerRow],
      predicate: SeriesComparisonMatchPlayerRow => Boolean,
  ): Int = rows.reverse.takeWhile(predicate).size

  private def histogram(
      allValues: List[Int],
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      value: SeriesComparisonMatchPlayerRow => Int,
  ): HistogramResponse =
    val bins = histogramBins(allValues)
    val series = playerOrder.map { memberId =>
      val counts = bins.map { bin =>
        rowsByPlayer.getOrElse(memberId, Nil).count(row =>
          value(row) >= bin.lowerInclusive && bin.upperExclusive.forall(value(row) < _)
        )
      }
      HistogramSeriesResponse(memberId.value, counts)
    }
    HistogramResponse(bins, series)

  private def histogramBins(values: List[Int]): List[HistogramBinResponse] = values match
    case Nil => Nil
    case nonEmpty =>
      val min = nonEmpty.min
      val max = nonEmpty.max
      if min == max then List(HistogramBinResponse(0, min, None, s"$min+"))
      else
        val sorted = nonEmpty.sorted
        val lowerAnchor =
          val p05 = percentile(sorted, Thresholds.HistogramLowerPercentile)
          if min < 0 && p05 >= 0 then 0 else math.floor(p05).toInt
        val p95 = percentile(sorted, Thresholds.HistogramUpperPercentile)
        val rawSpan = math.max(1, math.ceil(p95 - asDecimal(lowerAnchor)).toInt)
        val step = niceHistogramStep(
          math.ceil(asDecimal(rawSpan) / Thresholds.HistogramTargetBinCount).toInt
        )
        val lowerStart = math.floor(asDecimal(lowerAnchor) / asDecimal(step)).toInt * step
        val upperEnd = math.max(lowerStart + step, math.ceil(p95 / asDecimal(step)).toInt * step)
        val centralBins = Iterator.iterate(lowerStart)(_ + step).takeWhile(_ < upperEnd)
          .map(lower =>
            HistogramBinResponse(
              index = 0,
              lowerInclusive = lower,
              upperExclusive = Some(lower + step),
              label = s"$lower-${lower + step - 1}",
            )
          ).toList
        val lowerBin = Option.when(min < lowerStart)(HistogramBinResponse(
          index = 0,
          lowerInclusive = min,
          upperExclusive = Some(lowerStart),
          label = s"$min-${lowerStart - 1}",
        ))
        val upperBin = Option.when(max >= upperEnd)(HistogramBinResponse(
          index = 0,
          lowerInclusive = upperEnd,
          upperExclusive = None,
          label = s"$upperEnd+",
        ))
        (lowerBin.toList ++ centralBins ++ upperBin.toList).zipWithIndex.map { case (bin, index) =>
          bin.copy(index = index)
        }

  private def percentile(sortedValues: List[Int], probability: Double): Double =
    val clamped = math.max(0.0, math.min(1.0, probability))
    val rank = clamped * asDecimal(sortedValues.size - 1)
    val lowerIndex = math.floor(rank).toInt
    val upperIndex = math.ceil(rank).toInt
    val weight = rank - lowerIndex
    asDecimal(sortedValues(lowerIndex)) * (1.0 - weight) +
      asDecimal(sortedValues(upperIndex)) * weight

  private def percentileDouble(sortedValues: List[Int], probability: Double): Option[Double] =
    sortedValues match
      case Nil => None
      case nonEmpty => Some(percentile(nonEmpty, probability))

  private def medianDouble(values: List[Double]): Option[Double] = values.sorted match
    case Nil => None
    case sorted if sorted.size % 2 == 1 => Some(sorted(sorted.size / 2))
    case sorted =>
      val upper = sorted.size / 2
      Some((sorted(upper - 1) + sorted(upper)) / 2.0)

  private def niceHistogramStep(rawStep: Int): Int =
    val safeStep = math.max(1, rawStep)
    val magnitude = math.pow(10.0, math.floor(math.log10(asDecimal(safeStep)))).toInt
    val normalized = math.ceil(asDecimal(safeStep) / asDecimal(magnitude)).toInt
    val factor =
      if normalized <= 1 then 1
      else if normalized <= 2 then 2
      else if normalized <= 5 then 5
      else 10
    factor * magnitude

  private def dataQuality(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
      destinationRanks: Map[(String, String), Double],
  ): SeriesComparisonDataQualityResponse =
    val items = playerOrder.flatMap { memberId =>
      val rows = rowsByPlayer.getOrElse(memberId, Nil)
      val denominator = rows.size
      val ginjiTarget = rows.count(_.incidents.suriNoGinji >= 1)
      val maxRevenueByMatch = allRows.groupBy(_.matchId).view
        .mapValues(rs => rs.map(_.revenueManYen.value).max).toMap
      val highRevenueTarget = rows
        .count(row => maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value))
      val destinationMetric = destinationMetrics(rows, destinationRanks)
      val revenueOutcome = revenueOutcomeMetrics(rows, allRows, revenueRanks)
      val destinationOutcome = destinationOutcomeMetrics(rows, allRows, destinationRanks)
      val momentumTargetCounts = momentumSwitchTargetCounts(rows)
      val cardShopDestinationCounts = Map(
        "cardShopDestination.destinationWithShop" ->
          rows.count(row => row.incidents.destination > 0 && row.incidents.cardShop > 0),
        "cardShopDestination.destinationWithoutShop" ->
          rows.count(row => row.incidents.destination > 0 && row.incidents.cardShop == 0),
        "cardShopDestination.noDestinationWithShop" ->
          rows.count(row => row.incidents.destination == 0 && row.incidents.cardShop > 0),
        "cardShopDestination.noDestinationWithoutShop" ->
          rows.count(row => row.incidents.destination == 0 && row.incidents.cardShop == 0),
      )
      val normal = DenominatorMetricIds.map(metricId =>
        MetricQualityResponse(
          metricId,
          Some(memberId.value),
          denominator,
          denominator,
          normalStatus(denominator),
          hasTies = metricHasTies(metricId, revenueRanks, destinationRanks),
        )
      )
      val conditionalCounts = Map(
        "ginji.resilienceRankAverage" -> ginjiTarget,
        "ginji.resilienceAssetsAverage" -> ginjiTarget,
        "ginji.resilienceRevenueAverage" -> ginjiTarget,
        "nonRevenue.highRevenueNoWinRate" -> highRevenueTarget,
        "destination.dependenceScore" ->
          math.min(destinationMetric.upperTargetCount, destinationMetric.lowerTargetCount),
        "revenueOutcome.topWinRate" -> revenueOutcome.top.targetCount,
        "revenueOutcome.topPodiumRate" -> revenueOutcome.top.targetCount,
        "revenueOutcome.topLowerHalfRate" -> revenueOutcome.top.targetCount,
        "revenueOutcome.lowRevenuePodiumRate" -> revenueOutcome.lowRevenue.targetCount,
        "destinationOutcome.topWinRate" -> destinationOutcome.top.targetCount,
        "destinationOutcome.topPodiumRate" -> destinationOutcome.top.targetCount,
        "destinationOutcome.topLowerHalfRate" -> destinationOutcome.top.targetCount,
        "destinationOutcome.lowDestinationPodiumRate" ->
          destinationOutcome.lowDestination.targetCount,
        "destinationOutcome.zeroDestinationPodiumRate" ->
          destinationOutcome.zeroDestination.targetCount,
      ) ++ cardShopDestinationCounts
      val conditional = ConditionalMetricIds.map { metricId =>
        val target = conditionalCounts.getOrElse(metricId, 0)
        MetricQualityResponse(
          metricId,
          Some(memberId.value),
          denominator,
          target,
          conditionalStatus(target),
          hasTies = metricHasTies(metricId, revenueRanks, destinationRanks),
        )
      }
      val momentumSwitch = MomentumSwitchMetricIds.map { metricId =>
        val target = momentumTargetCounts.getOrElse(metricId, 0)
        MetricQualityResponse(
          metricId,
          Some(memberId.value),
          denominator,
          target,
          momentumSwitchStatus(target),
          hasTies = false,
        )
      }
      normal ++ conditional ++ momentumSwitch
    }
    SeriesComparisonDataQualityResponse(items)

  private def momentumSwitchTargetCounts(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): Map[String, Int] =
    val transitions = rankTransitions(sortedPlayerRows(rows))
    Map(
      "momentumSwitch.afterLowerPodiumRate" -> transitions.count(_.previous.rank.value >= 3),
      "momentumSwitch.afterFourthPodiumRate" -> transitions.count(_.previous.rank.value == 4),
      "momentumSwitch.afterPodiumLowerRate" -> transitions.count(_.previous.rank.value <= 2),
    )

  private def highlights(
      metrics: Map[String, SeriesComparisonPlayerMetricsResponse]
  ): List[SeriesComparisonHighlightResponse] = List(
    highlightMin(
      "highlight.ginjiResilience",
      "銀次リカバリー王",
      "ginji.resilienceRankAverage",
      metrics,
      _.ginji.resilienceRankAverage,
      _.ginji.encounterMatches,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.highRevenueNoWin",
      "収益空振り注意報",
      "nonRevenue.highRevenueNoWinRate",
      metrics,
      _.nonRevenue.highRevenueNoWinRate,
      _.nonRevenue.highRevenueTopCount,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.destinationCraft",
      "目的地職人",
      "destination.dependenceScore",
      metrics,
      _.destination.dependenceScore,
      m => math.min(m.destination.upperTargetCount, m.destination.lowerTargetCount),
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.destinationIndependent",
      "寄り道勝ち筋",
      "destination.conversionDelta",
      metrics,
      _.destination.conversionDelta,
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.assetsPeak",
      "資産ピーク王",
      "assets.max",
      metrics,
      _.assets.max.map(asDecimal),
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMax(
      "highlight.revenuePeak",
      "収益爆発王",
      "revenue.max",
      metrics,
      _.revenue.max.map(asDecimal),
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
    highlightMin(
      "highlight.stability",
      "安定社長",
      "stability.rankStandardDeviation",
      metrics,
      _.stability.rankStandardDeviation,
      _.denominator,
      requireTarget = Thresholds.MinimumOkSampleSize,
    ),
  ).flatten

  private def highlightMax(
      id: String,
      title: String,
      metricId: String,
      metrics: Map[String, SeriesComparisonPlayerMetricsResponse],
      value: SeriesComparisonPlayerMetricsResponse => Option[Double],
      target: SeriesComparisonPlayerMetricsResponse => Int,
      requireTarget: Int,
  ): Option[SeriesComparisonHighlightResponse] =
    highlight(id, title, metricId, metrics, value, target, requireTarget, chooseMax = true)

  private def highlightMin(
      id: String,
      title: String,
      metricId: String,
      metrics: Map[String, SeriesComparisonPlayerMetricsResponse],
      value: SeriesComparisonPlayerMetricsResponse => Option[Double],
      target: SeriesComparisonPlayerMetricsResponse => Int,
      requireTarget: Int,
  ): Option[SeriesComparisonHighlightResponse] =
    highlight(id, title, metricId, metrics, value, target, requireTarget, chooseMax = false)

  private def highlight(
      id: String,
      title: String,
      metricId: String,
      metrics: Map[String, SeriesComparisonPlayerMetricsResponse],
      value: SeriesComparisonPlayerMetricsResponse => Option[Double],
      target: SeriesComparisonPlayerMetricsResponse => Int,
      requireTarget: Int,
      chooseMax: Boolean,
  ): Option[SeriesComparisonHighlightResponse] =
    val candidates = metrics.toList.flatMap { case (memberId, m) =>
      value(m).filter(_ => target(m) >= requireTarget).map(v => (memberId, v, target(m)))
    }
    if candidates.isEmpty then None
    else
      val bestValue = if chooseMax then candidates.map(_._2).max else candidates.map(_._2).min
      val winners = candidates.filter(_._2 == bestValue)
      Some(SeriesComparisonHighlightResponse(
        id = id,
        title = title,
        winnerMemberIds = winners.map(_._1),
        metricId = metricId,
        value = Some(bestValue),
        targetCount = winners.map(_._3).min,
        status = "ok",
      ))

  private def rankByMatch(
      rows: List[SeriesComparisonMatchPlayerRow],
      value: SeriesComparisonMatchPlayerRow => Int,
  ): Map[(String, String), Double] = rows.groupBy(_.matchId).values.flatMap { matchRows =>
    val sortedValues = matchRows.map(value).distinct.sorted(using Ordering.Int.reverse)
    val ranksByValue = sortedValues.map { v =>
      val positions = matchRows.sortBy(row => -value(row)).zipWithIndex
        .collect { case (row, idx) if value(row) == v => idx + 1 }
      v -> averageUnsafe(positions.map(asDecimal))
    }.toMap
    matchRows.map(row => rankKey(row) -> ranksByValue(value(row)))
  }.toMap

  private def rankKey(row: SeriesComparisonMatchPlayerRow): (String, String) =
    (row.matchId.value, row.memberId.value)

  private def average(values: List[Double]): Option[Double] = values match
    case Nil => None
    case nonEmpty => Some(averageUnsafe(nonEmpty))

  private def averageUnsafe(values: List[Double]): Double = values.sum / asDecimal(values.size)

  private def median(values: List[Int]): Option[Double] = values.sorted match
    case Nil => None
    case sorted if sorted.size % 2 == 1 => Some(asDecimal(sorted(sorted.size / 2)))
    case sorted =>
      val upper = sorted.size / 2
      Some((asDecimal(sorted(upper - 1)) + asDecimal(sorted(upper))) / 2.0)

  private def stddev(values: List[Double]): Option[Double] = values match
    case Nil => None
    case nonEmpty =>
      val avg = averageUnsafe(nonEmpty)
      Some(math.sqrt(nonEmpty.map(v => math.pow(v - avg, 2)).sum / asDecimal(nonEmpty.size)))

  private def rate(count: Int, denominator: Int): Option[Double] = Option
    .when(denominator > 0)(asDecimal(count) / asDecimal(denominator))

  private def revenueAssetRate(row: SeriesComparisonMatchPlayerRow): Option[Double] = Option.when(
    row.totalAssetsManYen.value > 0
  )(asDecimal(row.revenueManYen.value) / asDecimal(row.totalAssetsManYen.value))

  private def strategyKind(entry: ProfileBase, entries: List[ProfileBase]): Option[String] =
    val rates = entries.flatMap(_.averageRevenueAssetRate)
    for
      median <- medianDouble(rates)
      value <- entry.averageRevenueAssetRate
    yield {
      if rates.size < Thresholds.MinimumOkSampleSize then "balanced"
      else if value >= median + Thresholds.StrategyKindMedianDeltaThreshold then "property_focused"
      else if value <= median - Thresholds.StrategyKindMedianDeltaThreshold then "card_focused"
      else "balanced"
    }

  private def asDecimal(value: Int): Double = java.lang.Integer.valueOf(value).doubleValue()

  private def normalStatus(denominator: Int): String =
    if denominator == 0 then "no_target"
    else if denominator < Thresholds.MinimumOkSampleSize then "reference"
    else "ok"

  private def conditionalStatus(targetCount: Int): String =
    if targetCount == 0 then "no_target"
    else if targetCount < Thresholds.MinimumOkSampleSize then "reference"
    else "ok"

  private def momentumSwitchStatus(targetCount: Int): String =
    if targetCount == 0 then "no_target"
    else if targetCount < Thresholds.MomentumSwitchMinimumOkSampleSize then "reference"
    else "ok"

  private def metricHasTies(
      metricId: String,
      revenueRanks: Map[(String, String), Double],
      destinationRanks: Map[(String, String), Double],
  ): Boolean =
    if metricId.startsWith("nonRevenue") || metricId.startsWith("revenueOutcome") then
      revenueRanks.values.exists(v => v != math.rint(v))
    else if metricId.startsWith("destination") || metricId.startsWith("destinationOutcome") then
      destinationRanks.values.exists(v => v != math.rint(v))
    else false
}
