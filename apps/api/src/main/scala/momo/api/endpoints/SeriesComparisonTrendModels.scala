package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.Schema

final case class SeriesComparisonTrendsResponse(
    rankCumulativeAverage: List[TrendSeriesResponse],
    rankCumulativeStandardDeviation: List[TrendSeriesResponse],
    podiumCumulativeRate: List[TrendSeriesResponse],
    lowerHalfCumulativeRate: List[TrendSeriesResponse],
    ginjiCumulativeCount: List[TrendSeriesResponse],
) derives Codec.AsObject
object SeriesComparisonTrendsResponse:
  given Schema[SeriesComparisonTrendsResponse] = Schema.derived

final case class TrendSeriesResponse(memberId: String, points: List[TrendPointResponse])
    derives Codec.AsObject
object TrendSeriesResponse:
  given Schema[TrendSeriesResponse] = Schema.derived

final case class TrendPointResponse(
    index: Int,
    matchId: String,
    playedAt: String,
    value: Option[Double],
) derives Codec.AsObject
object TrendPointResponse:
  given Schema[TrendPointResponse] = Schema.derived

final case class SeriesComparisonHistogramsResponse(
    assets: HistogramResponse,
    revenue: HistogramResponse,
) derives Codec.AsObject
object SeriesComparisonHistogramsResponse:
  given Schema[SeriesComparisonHistogramsResponse] = Schema.derived

final case class HistogramResponse(
    bins: List[HistogramBinResponse],
    series: List[HistogramSeriesResponse],
) derives Codec.AsObject
object HistogramResponse:
  given Schema[HistogramResponse] = Schema.derived

final case class HistogramBinResponse(
    index: Int,
    lowerInclusive: Int,
    upperExclusive: Option[Int],
    label: String,
) derives Codec.AsObject
object HistogramBinResponse:
  given Schema[HistogramBinResponse] = Schema.derived

final case class HistogramSeriesResponse(memberId: String, counts: List[Int]) derives Codec.AsObject
object HistogramSeriesResponse:
  given Schema[HistogramSeriesResponse] = Schema.derived

final case class HeadToHeadResponse(entries: List[HeadToHeadEntryResponse]) derives Codec.AsObject
object HeadToHeadResponse:
  given Schema[HeadToHeadResponse] = Schema.derived

final case class HeadToHeadEntryResponse(
    subjectMemberId: String,
    opponentMemberId: String,
    matchCount: Int,
    betterRankCount: Int,
    betterRankRate: Option[Double],
    averageRankDiff: Option[Double],
    averageAssetsDiff: Option[Double],
    status: String,
) derives Codec.AsObject
object HeadToHeadEntryResponse:
  given Schema[HeadToHeadEntryResponse] = Schema.derived

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
) derives Codec.AsObject
object MatchPlayerPointResponse:
  given Schema[MatchPlayerPointResponse] = Schema.derived

