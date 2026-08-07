package momo.api.usecases.seriescomparison.view

final case class SeriesComparisonRankAnalysisView(
    modelVersion: String,
    status: String,
    reasonCodes: List[String],
    heldEventCount: Int,
    matchCount: Int,
    improvedFoldCount: Int,
    foldScores: List[SeriesComparisonRankFoldScoreView],
    rankSignalsByPlayer: List[SeriesComparisonPlayerRankSignalsView],
    unexpectedWinsByPlayer: List[SeriesComparisonPlayerUnexpectedWinsView],
    crownCertainty: SeriesComparisonCrownCertaintyView,
)

final case class SeriesComparisonRankFoldScoreView(
    fold: Int,
    heldEventCount: Int,
    comparisonCount: Int,
    baselineLogLoss: Double,
    fullLogLoss: Double,
    baselineBrierScore: Double,
    fullBrierScore: Double,
    fullModelImproved: Boolean,
)

final case class SeriesComparisonPlayerRankSignalsView(
    memberId: String,
    status: String,
    signals: List[SeriesComparisonRankSignalView],
)

final case class SeriesComparisonRankSignalView(
    signal: String,
    direction: String,
    importance: Double,
    stable: Boolean,
)

final case class SeriesComparisonPlayerUnexpectedWinsView(
    memberId: String,
    status: String,
    totalWinCount: Int,
    unexpectedWinCount: Int,
    latest: Option[SeriesComparisonUnexpectedWinSummaryView],
    hasDetails: Boolean,
)

final case class SeriesComparisonUnexpectedWinSummaryView(
    matchId: String,
    heldEventId: String,
    matchNoInEvent: Int,
    playedAt: String,
    expectedRank: Double,
    actualRank: Int,
    evidence: SeriesComparisonUnexpectedWinEvidenceView,
)

final case class SeriesComparisonUnexpectedWinEvidenceView(
    revenueManYen: Int,
    destinationCount: Int,
    plusStationCount: Int,
    minusStationCount: Int,
    cardStationCount: Int,
    cardShopCount: Int,
    ginjiCount: Int,
)

final case class SeriesComparisonCrownCertaintyView(
    status: String,
    bootstrapIterations: Int,
    successfulIterations: Int,
    leaderChangeCount: Int,
    shares: List[SeriesComparisonCrownShareView],
)

final case class SeriesComparisonCrownShareView(
    memberId: String,
    share: Double,
)
