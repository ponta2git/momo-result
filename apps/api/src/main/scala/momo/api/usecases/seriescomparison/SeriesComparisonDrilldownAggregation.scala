package momo.api.usecases.seriescomparison

import java.time.format.DateTimeFormatter

import cats.syntax.all.*

import momo.api.domain.ids.{MatchId, MemberId}
import momo.api.domain.{SeriesComparisonMatchPlayerRow, SeriesComparisonResolvedScope}
import momo.api.endpoints.*

private[usecases] object SeriesComparisonDrilldownAggregation:
  private val Formatter = DateTimeFormatter.ISO_INSTANT
  private val SchemaVersion = 1

  def aggregate(
      scope: SeriesComparisonResolvedScope,
      metricId: String,
      memberId: MemberId,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesComparisonDrilldownResponse =
    val sortedRows = rows.sortBy(rowSortKey)
    val matchIndexById = matchIndexByIdFrom(sortedRows)
    val targetRows = sortedRows.filter(_.memberId == memberId)
    val status = statusFor(targetRows.size)
    val displayName = targetRows.headOption.map(_.memberDisplayName).getOrElse(memberId.value)
    val rankAverageHistory =
      Option.when(metricId == "rank.averageHistory")(
        rankAverageHistoryPayload(targetRows, matchIndexById, status)
      )
    val playOrderRankHistory =
      Option.when(metricId == "playOrder.rankHistory")(
        playOrderRankHistoryPayload(targetRows, sortedRows, matchIndexById)
      )
    SeriesComparisonDrilldownResponse(
      schemaVersion = SchemaVersion,
      metricId = metricId,
      scope = scopeResponse(scope),
      player = SeriesComparisonPlayerResponse(memberId = memberId.value, displayName = displayName),
      rankAverageHistory = rankAverageHistory,
      playOrderRankHistory = playOrderRankHistory,
      dataQuality = SeriesComparisonDataQualityResponse(List(
        MetricQualityResponse(
          metricId = metricId,
          playerMemberId = Some(memberId.value),
          denominator = targetRows.size,
          targetCount = targetRows.size,
          status = status,
          hasTies = false,
        )
      )),
    )

  private def rankAverageHistoryPayload(
      targetRows: List[SeriesComparisonMatchPlayerRow],
      matchIndexById: Map[MatchId, Int],
      status: String,
  ): SeriesComparisonRankAverageHistoryPayloadResponse =
    val matchRows = rankAverageMatchRows(targetRows, matchIndexById)
    val heldEventRows = rankAverageEventRows(matchRows)
    SeriesComparisonRankAverageHistoryPayloadResponse(
      summary = SeriesComparisonRankAverageHistorySummaryResponse(
        targetCount = targetRows.size,
        currentAverageRank = matchRows.lastOption.map(_.cumulativeAverageRank),
        averageRankDeltaFromFirst = Option.when(matchRows.size >= 2)(
          matchRows.last.cumulativeAverageRank - matchRows.head.cumulativeAverageRank
        ),
        latestHeldEventAverageRankDelta = heldEventRows.lastOption.flatMap(
          _.cumulativeAverageDelta
        ),
        status = status,
      ),
      matchRows = matchRows,
      heldEventRows = heldEventRows,
    )

  private def rankAverageMatchRows(
      rows: List[SeriesComparisonMatchPlayerRow],
      matchIndexById: Map[MatchId, Int],
  ): List[SeriesComparisonRankAverageHistoryMatchRowResponse] =
    val initial = RankAverageAccumulationState(Nil, 0, 0, None, None)
    rows.zipWithIndex.foldLeft(initial) { case (state, (row, index)) =>
      val nextCount = state.count + 1
      val nextRankTotal = state.rankTotal + row.rank.value
      val currentAverage = nextRankTotal * 1.0d / nextCount
      val response = SeriesComparisonRankAverageHistoryMatchRowResponse(
        matchIndex = matchIndexById.getOrElse(row.matchId, index + 1),
        matchId = row.matchId.value,
        playedAt = Formatter.format(row.playedAt),
        heldEventId = row.heldEventId.value,
        matchNoInEvent = row.matchNoInEvent.value,
        rank = row.rank.value,
        previousRank = state.previousRank,
        rankDelta = state.previousRank.map(previous => row.rank.value - previous),
        cumulativeAverageRank = currentAverage,
        cumulativeAverageRankDelta = state.previousAverage.map(currentAverage - _),
      )
      RankAverageAccumulationState(
        rows = response :: state.rows,
        count = nextCount,
        rankTotal = nextRankTotal,
        previousRank = Some(row.rank.value),
        previousAverage = Some(currentAverage),
      )
    }.rows.reverse

  private def playOrderRankHistoryPayload(
      targetRows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      matchIndexById: Map[MatchId, Int],
  ): SeriesComparisonPlayOrderRankHistoryPayloadResponse =
    val baselineAverageByPlayOrder = (1 to 4).map { playOrder =>
      val ranks = allRows.filter(_.playOrder.value == playOrder).map(_.rank.value)
      playOrder -> average(ranks)
    }.toMap
    val playOrderRows = playOrderHistoryRows(targetRows, baselineAverageByPlayOrder)
    val rankedPlayOrderRows = playOrderRows.filter(_.rankAverage.nonEmpty)
      .sortBy(_.rankAverage.getOrElse(Double.MaxValue))
    val best = rankedPlayOrderRows.headOption
    val worst = rankedPlayOrderRows.lastOption
    val averageTrendRows = playOrderAverageTrendRows(targetRows, matchIndexById)
    SeriesComparisonPlayOrderRankHistoryPayloadResponse(
      summary = SeriesComparisonPlayOrderRankHistorySummaryResponse(
        targetCount = targetRows.size,
        currentAverageRank = average(targetRows.map(_.rank.value)),
        bestPlayOrder = best.map(_.playOrder),
        bestPlayOrderAverageRank = best.flatMap(_.rankAverage),
        worstPlayOrder = worst.map(_.playOrder),
        worstPlayOrderAverageRank = worst.flatMap(_.rankAverage),
        spread = Option.when(rankedPlayOrderRows.size >= 2)(
          worst.flatMap(_.rankAverage).getOrElse(0.0) - best.flatMap(_.rankAverage).getOrElse(0.0)
        ),
        countsByPlayOrder = (1 to 4).toList.map(playOrder =>
          SeriesComparisonPlayOrderCountResponse(
            playOrder = playOrder,
            matchCount = targetRows.count(_.playOrder.value == playOrder),
          )
        ),
      ),
      averageTrendRows = averageTrendRows,
      playOrderRows = playOrderRows,
    )

  private def playOrderHistoryRows(
      rows: List[SeriesComparisonMatchPlayerRow],
      baselineAverageByPlayOrder: Map[Int, Option[Double]],
  ): List[SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse] = (1 to 4).toList.map {
    playOrder =>
      val targetRows = rows.filter(_.playOrder.value == playOrder)
      val ranks = targetRows.map(_.rank.value)
      val rankAverage = average(ranks)
      val podiumCount = ranks.count(rank => rank == 1 || rank == 2)
      val lowerHalfCount = ranks.count(rank => rank == 3 || rank == 4)
      val baseline = baselineAverageByPlayOrder.getOrElse(playOrder, None)
      SeriesComparisonPlayOrderRankHistoryPlayOrderRowResponse(
        playOrder = playOrder,
        matchCount = targetRows.size,
        rankAverage = rankAverage,
        rankDistribution = (1 to 4).toList.map { rank =>
          val count = ranks.count(_ == rank)
          RankDistributionResponse(rank, count, rate(count, targetRows.size))
        },
        podiumCount = podiumCount,
        podiumRate = rate(podiumCount, targetRows.size),
        lowerHalfCount = lowerHalfCount,
        lowerHalfRate = rate(lowerHalfCount, targetRows.size),
        baselineRankAverage = baseline,
        baselineDelta = (rankAverage, baseline).mapN(_ - _),
      )
  }

  private def playOrderAverageTrendRows(
      rows: List[SeriesComparisonMatchPlayerRow],
      matchIndexById: Map[MatchId, Int],
  ): List[SeriesComparisonPlayOrderRankHistoryTrendRowResponse] =
    val initial = PlayOrderAverageTrendState(Nil, Map.empty, Map.empty)
    rows.zipWithIndex.foldLeft(initial) { case (state, (row, index)) =>
      val playOrder = row.playOrder.value
      val previousCount = state.countByPlayOrder.getOrElse(playOrder, 0)
      val previousRankTotal = state.rankTotalByPlayOrder.getOrElse(playOrder, 0)
      val currentCount = previousCount + 1
      val currentRankTotal = previousRankTotal + row.rank.value
      val previousAverage = Option.when(previousCount > 0)(
        previousRankTotal * 1.0d / previousCount
      )
      val currentAverage = currentRankTotal * 1.0d / currentCount
      val response = SeriesComparisonPlayOrderRankHistoryTrendRowResponse(
        matchIndex = matchIndexById.getOrElse(row.matchId, index + 1),
        matchId = row.matchId.value,
        playedAt = Formatter.format(row.playedAt),
        heldEventId = row.heldEventId.value,
        matchNoInEvent = row.matchNoInEvent.value,
        playOrder = playOrder,
        rank = row.rank.value,
        playOrderOccurrenceIndex = currentCount,
        cumulativeAverageRankByPlayOrder = currentAverage,
        previousCumulativeAverageRankByPlayOrder = previousAverage,
        cumulativeAverageRankDeltaByPlayOrder = previousAverage.map(currentAverage - _),
      )
      PlayOrderAverageTrendState(
        rows = response :: state.rows,
        countByPlayOrder = state.countByPlayOrder.updated(playOrder, currentCount),
        rankTotalByPlayOrder = state.rankTotalByPlayOrder.updated(playOrder, currentRankTotal),
      )
    }.rows.reverse

  private def rankAverageEventRows(
      rows: List[SeriesComparisonRankAverageHistoryMatchRowResponse]
  ): List[SeriesComparisonRankAverageHistoryEventRowResponse] =
    rows.groupBy(_.heldEventId).toList.sortBy { case (_, eventRows) =>
      eventRows.map(_.matchIndex).minOption.getOrElse(Int.MaxValue)
    }.map { case (heldEventId, eventRows) =>
      val sorted = eventRows.sortBy(_.matchIndex)
      val ranks = sorted.map(_.rank)
      val first = sorted.head
      val last = sorted.last
      val cumulativeAverageBefore = first.cumulativeAverageRankDelta.map(delta =>
        first.cumulativeAverageRank - delta
      )
      SeriesComparisonRankAverageHistoryEventRowResponse(
        heldEventId = heldEventId,
        firstPlayedAt = first.playedAt,
        matchCount = sorted.size,
        ranks = ranks,
        eventAverageRank = averageUnsafe(ranks),
        eventRankDelta = Option.when(ranks.size >= 2)(ranks.last - ranks.head),
        cumulativeAverageBefore = cumulativeAverageBefore,
        cumulativeAverageAfter = last.cumulativeAverageRank,
        cumulativeAverageDelta = cumulativeAverageBefore.map(last.cumulativeAverageRank - _),
      )
    }

  private def matchIndexByIdFrom(
      rows: List[SeriesComparisonMatchPlayerRow]
  ): Map[MatchId, Int] = rows.groupBy(_.matchId).toList.sortBy { case (_, groupRows) =>
    val first = groupRows.sortBy(rowSortKey).head
    rowSortKey(first)
  }.zipWithIndex.map { case ((matchId, _), index) => matchId -> (index + 1) }.toMap

  private def rowSortKey(row: SeriesComparisonMatchPlayerRow) =
    (
      row.playedAt.toEpochMilli,
      row.heldEventId.value,
      row.matchNoInEvent.value,
      row.matchId.value,
      row.memberId.value,
    )

  private def averageUnsafe(values: List[Int]): Double =
    values.sum * 1.0d / values.size

  private def average(values: List[Int]): Option[Double] = values match
    case Nil => None
    case xs => Some(averageUnsafe(xs))

  private def rate(count: Int, denominator: Int): Option[Double] = Option
    .when(denominator > 0)(count * 1.0d / denominator)

  private def statusFor(targetCount: Int): String =
    if targetCount <= 0 then "no_target" else if targetCount < 3 then "reference" else "ok"

  private def scopeResponse(scope: SeriesComparisonResolvedScope): SeriesComparisonScopeResponse =
    SeriesComparisonScopeResponse(
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
    )

  private final case class RankAverageAccumulationState(
      rows: List[SeriesComparisonRankAverageHistoryMatchRowResponse],
      count: Int,
      rankTotal: Int,
      previousRank: Option[Int],
      previousAverage: Option[Double],
  )

  private final case class PlayOrderAverageTrendState(
      rows: List[SeriesComparisonPlayOrderRankHistoryTrendRowResponse],
      countByPlayOrder: Map[Int, Int],
      rankTotalByPlayOrder: Map[Int, Int],
  )
