package momo.api.usecases.seriescomparison

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.SeriesComparisonPlaybookCardView

private[seriescomparison] final case class PlaybookCandidate(
    memberId: MemberId,
    memberDisplayName: String,
    card: SeriesComparisonPlaybookCardView,
    peerEffectValue: Double,
    baseScore: Double,
)

private[seriescomparison] final case class ScoredPlaybookCandidate(
    candidate: PlaybookCandidate,
    finalScore: Double,
    peerRank: Int,
    peerCount: Int,
    peerDistinctiveness: Double,
    commonCategory: Boolean,
)

private[seriescomparison] final case class RecoveryTransition(
    previous: SeriesComparisonMatchPlayerRow,
    current: SeriesComparisonMatchPlayerRow,
    revenueRankScore: Double,
    destinationRankScore: Double,
    accidentCount: Double,
)

private[seriescomparison] final case class RecoveryDriver(
    kind: String,
    strength: Double,
    effect: Double,
)

private[seriescomparison] final case class ActionDriver(
    kind: String,
    effect: Double,
    actionability: Double,
)

private[seriescomparison] final case class ActionDriverSelection(
    kind: String,
    effect: Double,
    effectStrength: Double,
    selectionStrength: Double,
    closeToSecond: Boolean,
)

private[seriescomparison] final case class BootstrapInterval(low: Double, high: Double)
