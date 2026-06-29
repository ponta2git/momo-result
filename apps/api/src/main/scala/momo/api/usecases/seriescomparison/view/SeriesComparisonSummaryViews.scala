package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonView(
    schemaVersion: Int,
    scope: SeriesComparisonScopeView,
    matchCount: Int,
    players: List[SeriesComparisonPlayerView],
    metricsByPlayer: List[SeriesComparisonPlayerMetricsEntry],
    trends: SeriesComparisonTrendsView,
    histograms: SeriesComparisonHistogramsView,
    headToHead: HeadToHeadView,
    matchPlayerPoints: List[MatchPlayerPointView],
    recentFormByPlayer: List[RecentFormPlayerView],
    momentumSwitch: MomentumSwitchView,
    playerPerformanceProfiles: PlayerPerformanceProfilesView,
    assetStyleProfiles: AssetStyleProfilesView,
    matchNoInEventBreakdown: List[MatchNoInEventBreakdownView],
    matchTimeline: List[MatchTimelinePointView],
    cardShopDestination: CardShopDestinationView,
    playOrderBaselines: List[PlayOrderBaselineView],
    highlights: List[SeriesComparisonHighlightView],
    dataQuality: SeriesComparisonDataQualityView,
)
