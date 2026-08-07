package momo.api.usecases.seriescomparison.engine

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.{HeldEventId, MatchId, MemberId}

private[seriescomparison] enum RankAnalysisQuality derives CanEqual:
  case Ok
  case Reference
  case NoTarget

private[seriescomparison] enum RankAnalysisReason derives CanEqual:
  case InsufficientEvents
  case InsufficientMatches
  case InvalidDataset
  case NumericalFailure
  case ModelNotBetter
  case UnstableSignals

private[seriescomparison] enum RankSignalKind derives CanEqual:
  case Revenue
  case Destination
  case PlusStation
  case MinusStation
  case CardStation
  case CardShop
  case Ginji

private[seriescomparison] object RankSignalKind:
  val valuesInFeatureOrder: Vector[RankSignalKind] = Vector(
    RankSignalKind.Revenue,
    RankSignalKind.Destination,
    RankSignalKind.PlusStation,
    RankSignalKind.MinusStation,
    RankSignalKind.CardStation,
    RankSignalKind.CardShop,
    RankSignalKind.Ginji,
  )

private[seriescomparison] enum RankSignalDirection derives CanEqual:
  case MoreIsHigher
  case LessIsHigher

private[seriescomparison] final case class RankFoldScore(
    fold: Int,
    heldEventCount: Int,
    comparisonCount: Int,
    baselineLogLoss: Double,
    fullLogLoss: Double,
    baselineBrierScore: Double,
    fullBrierScore: Double,
):
  val fullModelImproved: Boolean = fullLogLoss < baselineLogLoss

private[seriescomparison] final case class PlayerRankSignal(
    kind: RankSignalKind,
    direction: RankSignalDirection,
    importance: Double,
    foldImportances: Vector[Double],
    stable: Boolean,
)

private[seriescomparison] final case class PlayerRankSignals(
    memberId: MemberId,
    signals: Vector[PlayerRankSignal],
)

private[seriescomparison] final case class UnexpectedWin(
    matchId: MatchId,
    heldEventId: HeldEventId,
    matchNoInEvent: Int,
    playedAtEpochMilli: Long,
    memberId: MemberId,
    expectedRank: Double,
    row: SeriesComparisonMatchPlayerRow,
)

private[seriescomparison] final case class PlayerUnexpectedWins(
    memberId: MemberId,
    totalWinCount: Int,
    wins: Vector[UnexpectedWin],
)

private[seriescomparison] final case class CrownShare(
    memberId: MemberId,
    share: Double,
)

private[seriescomparison] final case class CrownCertainty(
    bootstrapIterations: Int,
    successfulIterations: Int,
    leaderChangeCount: Int,
    shares: Vector[CrownShare],
)

private[seriescomparison] final case class RankAnalysisResult(
    modelVersion: String,
    quality: RankAnalysisQuality,
    reasons: Vector[RankAnalysisReason],
    heldEventCount: Int,
    matchCount: Int,
    improvedFoldCount: Int,
    foldScores: Vector[RankFoldScore],
    rankSignals: Vector[PlayerRankSignals],
    unexpectedWins: Vector[PlayerUnexpectedWins],
    crownCertainty: CrownCertainty,
)

private[seriescomparison] final case class RankAnalysisConfig(
    foldCount: Int,
    bootstrapIterations: Int,
    bootstrapSeed: Long,
    minimumImportance: Double,
    modelConfig: BradleyTerryConfig,
)

private[seriescomparison] object RankAnalysisConfig:
  val production: RankAnalysisConfig = RankAnalysisConfig(
    foldCount = 5,
    bootstrapIterations = 128,
    bootstrapSeed = 0x6d6f6d6f72616e6bL,
    minimumImportance = 0.0001,
    modelConfig = BradleyTerryConfig(),
  )

private[seriescomparison] final case class EncodedRankRow(
    source: SeriesComparisonMatchPlayerRow,
    signalFeatures: Vector[Double],
    adjustmentFeatures: Vector[Double],
):
  val fullFeatures: Vector[Double] = signalFeatures ++ adjustmentFeatures

private[seriescomparison] final case class EncodedRankMatch(
    matchId: MatchId,
    rows: Vector[EncodedRankRow],
)

private[seriescomparison] final case class EncodedRankEvent(
    heldEventId: HeldEventId,
    playedAtEpochMilli: Long,
    matches: Vector[EncodedRankMatch],
)

private[seriescomparison] final case class PairwiseRankRecord(
    heldEventId: HeldEventId,
    matchId: MatchId,
    left: EncodedRankRow,
    right: EncodedRankRow,
    fullObservation: PairwiseRankObservation,
    baselineObservation: PairwiseRankObservation,
)

private[seriescomparison] final case class FoldRankEvaluation(
    score: RankFoldScore,
    testEvents: Vector[EncodedRankEvent],
    testPairs: Vector[PairwiseRankRecord],
    fullFit: BradleyTerryFit,
)
