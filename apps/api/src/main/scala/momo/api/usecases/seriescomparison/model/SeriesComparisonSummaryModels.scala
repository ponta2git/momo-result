package momo.api.usecases.seriescomparison.model


final case class SeriesComparisonResponse(
    schemaVersion: Int,
    scope: SeriesComparisonScopeResponse,
    matchCount: Int,
    players: List[SeriesComparisonPlayerResponse],
    metricsByPlayer: List[SeriesComparisonPlayerMetricsEntry],
    trends: SeriesComparisonTrendsResponse,
    histograms: SeriesComparisonHistogramsResponse,
    headToHead: HeadToHeadResponse,
    matchPlayerPoints: List[MatchPlayerPointResponse],
    recentFormByPlayer: List[RecentFormPlayerResponse],
    momentumSwitch: MomentumSwitchResponse,
    playerPerformanceProfiles: PlayerPerformanceProfilesResponse,
    assetStyleProfiles: AssetStyleProfilesResponse,
    matchNoInEventBreakdown: List[MatchNoInEventBreakdownResponse],
    matchTimeline: List[MatchTimelinePointResponse],
    cardShopDestination: CardShopDestinationResponse,
    playOrderBaselines: List[PlayOrderBaselineResponse],
    highlights: List[SeriesComparisonHighlightResponse],
    dataQuality: SeriesComparisonDataQualityResponse,
)
