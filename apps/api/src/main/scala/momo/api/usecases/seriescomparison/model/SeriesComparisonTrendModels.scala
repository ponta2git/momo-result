package momo.api.usecases.seriescomparison.model


final case class SeriesComparisonTrendsResponse(
    rankCumulativeAverage: List[TrendSeriesResponse],
    rankCumulativeStandardDeviation: List[TrendSeriesResponse],
    podiumCumulativeRate: List[TrendSeriesResponse],
    lowerHalfCumulativeRate: List[TrendSeriesResponse],
    ginjiCumulativeCount: List[TrendSeriesResponse],
)
final case class TrendSeriesResponse(memberId: String, points: List[TrendPointResponse])
   
final case class TrendPointResponse(
    index: Int,
    matchId: String,
    playedAt: String,
    value: Option[Double],
)
final case class SeriesComparisonHistogramsResponse(
    assets: HistogramResponse,
    revenue: HistogramResponse,
)
final case class HistogramResponse(
    bins: List[HistogramBinResponse],
    series: List[HistogramSeriesResponse],
)
final case class HistogramBinResponse(
    index: Int,
    lowerInclusive: Int,
    upperExclusive: Option[Int],
    label: String,
)
final case class HistogramSeriesResponse(memberId: String, counts: List[Int])
final case class HeadToHeadResponse(entries: List[HeadToHeadEntryResponse])
final case class HeadToHeadEntryResponse(
    subjectMemberId: String,
    opponentMemberId: String,
    matchCount: Int,
    betterRankCount: Int,
    betterRankRate: Option[Double],
    averageRankDiff: Option[Double],
    averageAssetsDiff: Option[Double],
    status: String,
)
final case class MatchPlayerPointResponse(
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
