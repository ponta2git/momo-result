package momo.api.usecases

import java.time.format.DateTimeFormatter

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.MemberId
import momo.api.domain.{SeriesComparisonMatchPlayerRow, SeriesComparisonResolvedScope, SeriesComparisonScope}
import momo.api.endpoints.*
import momo.api.errors.AppError
import momo.api.repositories.SeriesComparisonReadModel

final class GetSeriesComparison[F[_]: Monad](readModel: SeriesComparisonReadModel[F]):
  def run(scope: SeriesComparisonScope): F[Either[AppError, SeriesComparisonResponse]] =
    readModel.resolveScope(scope).flatMap {
      case None => Monad[F].pure(Left(AppError.NotFound("series comparison scope", scopeKey(scope))))
      case Some(resolved) => readModel.loadRows(resolved).map(rows =>
          Right(SeriesComparisonAggregation.aggregate(resolved, rows))
        )
    }

  private def scopeKey(scope: SeriesComparisonScope): String =
    scope.scopeIdValue.fold(scope.selectedGameTitleId.value)(id =>
      s"${scope.selectedGameTitleId.value}:$id"
    )

object GetSeriesComparison:
  def apply[F[_]: Monad](readModel: SeriesComparisonReadModel[F]): GetSeriesComparison[F] =
    new GetSeriesComparison(readModel)

private object SeriesComparisonAggregation:
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
  )
  private val ConditionalMetricIds = List(
    "ginji.resilienceRankAverage",
    "ginji.resilienceAssetsAverage",
    "ginji.resilienceRevenueAverage",
    "nonRevenue.highRevenueNoWinRate",
    "destination.dependenceScore",
  )

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
    val playerOrder = rowsByPlayer.values.toList.map(_.head).sortBy(row =>
      (row.playOrder.value, row.memberDisplayName, row.memberId.value)
    ).map(_.memberId)
    val players = playerOrder.map { memberId =>
      val first = rowsByPlayer(memberId).head
      SeriesComparisonPlayerResponse(memberId.value, first.memberDisplayName)
    }
    val revenueRanks = rankByMatch(orderedRows, _.revenueManYen.value)
    val destinationRanks = rankByMatch(orderedRows, _.incidents.destination)
    val assetsHistogram = histogram(orderedRows.map(_.totalAssetsManYen.value), playerOrder, rowsByPlayer, row =>
      row.totalAssetsManYen.value
    )
    val revenueHistogram = histogram(orderedRows.map(_.revenueManYen.value), playerOrder, rowsByPlayer, row =>
      row.revenueManYen.value
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
    val quality = dataQuality(playerOrder, rowsByPlayer, orderedRows, revenueRanks, destinationRanks)
    SeriesComparisonResponse(
      schemaVersion = 1,
      scope = SeriesComparisonScopeResponse(
        gameTitleId = scope.gameTitleId.value,
        gameTitleName = scope.gameTitleName,
        layoutFamily = scope.layoutFamily,
        scopeKind = scope.scopeKind,
        scopeId = scope.scopeId,
        scopeName = scope.scopeName,
      ),
      matchCount = matchCount,
      players = players,
      metricsByPlayer = playerOrder.map(memberId =>
        SeriesComparisonPlayerMetricsEntry(memberId.value, metrics(memberId.value))
      ),
      trends = trends(playerOrder, rowsByPlayer),
      histograms = SeriesComparisonHistogramsResponse(assetsHistogram, revenueHistogram),
      highlights = highlights(metrics),
      dataQuality = quality,
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
        resilienceAssetsAverage = average(ginjiRows.map(row =>
          asDecimal(row.totalAssetsManYen.value)
        )),
        resilienceRevenueAverage = average(ginjiRows.map(row =>
          asDecimal(row.revenueManYen.value)
        )),
      ),
      nonRevenue = highRevenue,
      destination = destination,
      stability = StabilityMetricsResponse(stddev(ranks.map(asDecimal))),
    )

  private def playOrderMetrics(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): PlayOrderMetricsResponse =
    def baseline(value: SeriesComparisonMatchPlayerRow => Double): Map[Int, Double] =
      allRows.groupBy(_.playOrder.value).view.mapValues(rs => averageUnsafe(rs.map(value))).toMap
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
    )

  private def highRevenueNoWin(
      rows: List[SeriesComparisonMatchPlayerRow],
      allRows: List[SeriesComparisonMatchPlayerRow],
      revenueRanks: Map[(String, String), Double],
  ): NonRevenueMetricsResponse =
    val revenueRankValues = rows.flatMap(row => revenueRanks.get(rankKey(row)))
    val rankDelta = for
      avgRevenueRank <- average(revenueRankValues)
      avgRank <- average(rows.map(row => asDecimal(row.rank.value)))
    yield avgRevenueRank - avgRank
    val maxRevenueByMatch = allRows.groupBy(_.matchId).view.mapValues(rs =>
      rs.map(_.revenueManYen.value).max
    ).toMap
    val topRows = rows.filter { row =>
      maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value)
    }
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
    val conversion = for
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

  private def trends(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): SeriesComparisonTrendsResponse =
    def series(
        value: (SeriesComparisonMatchPlayerRow, Int) => Double
    ): List[TrendSeriesResponse] = playerOrder.map { memberId =>
      val rows = rowsByPlayer.getOrElse(memberId, Nil).sortBy(row =>
        (row.playedAt.toEpochMilli, row.heldEventId.value, row.matchNoInEvent.value, row.matchId.value)
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

  private def histogramBins(values: List[Int]): List[HistogramBinResponse] =
    values match
      case Nil => Nil
      case nonEmpty =>
        val min = nonEmpty.min
        val max = nonEmpty.max
        if min == max then List(HistogramBinResponse(0, min, None, min.toString))
        else
          val binCount = math.min(8, math.max(1, nonEmpty.distinct.size))
          val step = math.max(1, math.ceil(asDecimal(max - min + 1) / asDecimal(binCount)).toInt)
          (0 until binCount).toList.map { idx =>
            val lower = min + step * idx
            val upper = if idx == binCount - 1 then None else Some(lower + step)
            HistogramBinResponse(idx, lower, upper, upper.fold(s"$lower+")(u => s"$lower-${
                u - 1
              }"))
          }

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
      val maxRevenueByMatch = allRows.groupBy(_.matchId).view.mapValues(rs =>
        rs.map(_.revenueManYen.value).max
      ).toMap
      val highRevenueTarget = rows.count { row =>
        maxRevenueByMatch.get(row.matchId).contains(row.revenueManYen.value)
      }
      val destinationMetric = destinationMetrics(rows, destinationRanks)
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
      )
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
      normal ++ conditional
    }
    SeriesComparisonDataQualityResponse(items)

  private def highlights(
      metrics: Map[String, SeriesComparisonPlayerMetricsResponse]
  ): List[SeriesComparisonHighlightResponse] =
    List(
      highlightMin(
        "highlight.ginjiResilience",
        "銀次リカバリー王",
        "ginji.resilienceRankAverage",
        metrics,
        _.ginji.resilienceRankAverage,
        _.ginji.encounterMatches,
        requireTarget = 5,
      ),
      highlightMax(
        "highlight.highRevenueNoWin",
        "稼ぎ空振り注意報",
        "nonRevenue.highRevenueNoWinRate",
        metrics,
        _.nonRevenue.highRevenueNoWinRate,
        _.nonRevenue.highRevenueTopCount,
        requireTarget = 5,
      ),
      highlightMax(
        "highlight.destinationCraft",
        "目的地職人",
        "destination.dependenceScore",
        metrics,
        _.destination.dependenceScore,
        m => math.min(m.destination.upperTargetCount, m.destination.lowerTargetCount),
        requireTarget = 5,
      ),
      highlightMax(
        "highlight.destinationIndependent",
        "寄り道勝ち筋",
        "destination.conversionDelta",
        metrics,
        _.destination.conversionDelta,
        _.denominator,
        requireTarget = 3,
      ),
      highlightMax(
        "highlight.assetsPeak",
        "資産ピーク王",
        "assets.max",
        metrics,
        _.assets.max.map(asDecimal),
        _.denominator,
        requireTarget = 3,
      ),
      highlightMax(
        "highlight.revenuePeak",
        "収益爆発王",
        "revenue.max",
        metrics,
        _.revenue.max.map(asDecimal),
        _.denominator,
        requireTarget = 3,
      ),
      highlightMin(
        "highlight.stability",
        "安定社長",
        "stability.rankStandardDeviation",
        metrics,
        _.stability.rankStandardDeviation,
        _.denominator,
        requireTarget = 3,
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
  ): Option[SeriesComparisonHighlightResponse] = highlight(
    id,
    title,
    metricId,
    metrics,
    value,
    target,
    requireTarget,
    chooseMax = true,
  )

  private def highlightMin(
      id: String,
      title: String,
      metricId: String,
      metrics: Map[String, SeriesComparisonPlayerMetricsResponse],
      value: SeriesComparisonPlayerMetricsResponse => Option[Double],
      target: SeriesComparisonPlayerMetricsResponse => Int,
      requireTarget: Int,
  ): Option[SeriesComparisonHighlightResponse] = highlight(
    id,
    title,
    metricId,
    metrics,
    value,
    target,
    requireTarget,
    chooseMax = false,
  )

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
      val bestValue =
        if chooseMax then candidates.map(_._2).max
        else candidates.map(_._2).min
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
      val positions = matchRows.sortBy(row => -value(row)).zipWithIndex.collect {
        case (row, idx) if value(row) == v => idx + 1
      }
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

  private def rate(count: Int, denominator: Int): Option[Double] =
    Option.when(denominator > 0)(asDecimal(count) / asDecimal(denominator))

  private def asDecimal(value: Int): Double = java.lang.Integer.valueOf(value).doubleValue()

  private def normalStatus(denominator: Int): String =
    if denominator == 0 then "no_target"
    else if denominator < 3 then "reference"
    else "ok"

  private def conditionalStatus(targetCount: Int): String =
    if targetCount == 0 then "no_target"
    else if targetCount < 5 then "reference"
    else "ok"

  private def metricHasTies(
      metricId: String,
      revenueRanks: Map[(String, String), Double],
      destinationRanks: Map[(String, String), Double],
  ): Boolean =
    if metricId.startsWith("nonRevenue") then revenueRanks.values.exists(v => v != math.rint(v))
    else if metricId.startsWith("destination") then destinationRanks.values.exists(v =>
      v != math.rint(v)
    )
    else false
