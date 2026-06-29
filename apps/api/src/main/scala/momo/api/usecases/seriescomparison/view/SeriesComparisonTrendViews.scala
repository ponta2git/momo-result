package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonTrendsView(
    rankCumulativeAverage: List[TrendSeriesView],
    rankCumulativeStandardDeviation: List[TrendSeriesView],
    podiumCumulativeRate: List[TrendSeriesView],
    lowerHalfCumulativeRate: List[TrendSeriesView],
    ginjiCumulativeCount: List[TrendSeriesView],
)
final case class TrendSeriesView(memberId: String, points: List[TrendPointView])

final case class TrendPointView(
    index: Int,
    matchId: String,
    playedAt: String,
    value: Option[Double],
)
final case class SeriesComparisonHistogramsView(
    assets: HistogramView,
    revenue: HistogramView,
)
final case class HistogramView(
    bins: List[HistogramBinView],
    series: List[HistogramSeriesView],
)
final case class HistogramBinView(
    index: Int,
    lowerInclusive: Int,
    upperExclusive: Option[Int],
    label: String,
)
final case class HistogramSeriesView(memberId: String, counts: List[Int])
final case class HeadToHeadView(entries: List[HeadToHeadEntryView])
final case class HeadToHeadEntryView(
    subjectMemberId: String,
    opponentMemberId: String,
    matchCount: Int,
    betterRankCount: Int,
    betterRankRate: Option[Double],
    averageRankDiff: Option[Double],
    averageAssetsDiff: Option[Double],
    status: String,
)
final case class MatchPlayerPointView(
    matchIndex: Int,
    matchId: String,
    playedAt: String,
    memberId: String,
    rank: Int,
    totalAssets: Int,
    revenue: Int,
    revenueAssetRate: Option[Double],
    assetsRank: Double,
    revenueRank: Double,
)
