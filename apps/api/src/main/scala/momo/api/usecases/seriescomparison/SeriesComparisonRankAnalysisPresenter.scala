package momo.api.usecases.seriescomparison

import java.time.format.DateTimeFormatter

import scala.util.Try

import momo.api.usecases.seriescomparison.engine.*
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] object SeriesComparisonRankAnalysisPresenter:
  def analyze(dataset: SeriesDataset): SeriesComparisonRankAnalysisView =
    Try(SeriesRankAnalyzer.analyze(dataset)).fold(
      _ => calculationFailed(dataset),
      present,
    )

  private def present(result: RankAnalysisResult): SeriesComparisonRankAnalysisView =
    SeriesComparisonRankAnalysisView(
      modelVersion = result.modelVersion,
      status = qualityWire(result.quality),
      reasonCodes = result.reasons.map(reasonWire).toList,
      heldEventCount = result.heldEventCount,
      matchCount = result.matchCount,
      improvedFoldCount = result.improvedFoldCount,
      foldScores = result.foldScores.map(foldScoreView).toList,
      rankSignalsByPlayer = result.rankSignals.map { player =>
        SeriesComparisonPlayerRankSignalsView(
          memberId = player.memberId.value,
          status = signalStatus(result.quality, player),
          signals = player.signals.map(signalView).toList,
        )
      }.toList,
      unexpectedWinsByPlayer = result.unexpectedWins.map { player =>
        SeriesComparisonPlayerUnexpectedWinsView(
          memberId = player.memberId.value,
          status = unexpectedWinStatus(result.quality, player.totalWinCount),
          totalWinCount = player.totalWinCount,
          unexpectedWinCount = player.wins.size,
          latest = player.wins.lastOption.map(unexpectedWinView),
          hasDetails = player.wins.nonEmpty,
        )
      }.toList,
      crownCertainty = SeriesComparisonCrownCertaintyView(
        status = qualityWire(result.quality),
        bootstrapIterations = result.crownCertainty.bootstrapIterations,
        successfulIterations = result.crownCertainty.successfulIterations,
        leaderChangeCount = result.crownCertainty.leaderChangeCount,
        shares = result.crownCertainty.shares.map { share =>
          SeriesComparisonCrownShareView(share.memberId.value, share.share)
        }.toList,
      ),
    )

  private def calculationFailed(dataset: SeriesDataset): SeriesComparisonRankAnalysisView =
    SeriesComparisonRankAnalysisView(
      modelVersion = SeriesRankAnalyzer.ModelVersion,
      status = "no_target",
      reasonCodes = List("calculation_failed"),
      heldEventCount = dataset.orderedRows.map(_.heldEventId).distinct.size,
      matchCount = dataset.matchCount,
      improvedFoldCount = 0,
      foldScores = Nil,
      rankSignalsByPlayer = dataset.playerOrder.map(memberId =>
        SeriesComparisonPlayerRankSignalsView(memberId.value, "no_target", Nil)
      ),
      unexpectedWinsByPlayer = dataset.playerOrder.map { memberId =>
        val totalWinCount = dataset.rowsByPlayer.getOrElse(memberId, Nil).count(_.rank.value == 1)
        SeriesComparisonPlayerUnexpectedWinsView(
          memberId.value,
          "no_target",
          totalWinCount,
          unexpectedWinCount = 0,
          latest = None,
          hasDetails = false,
        )
      },
      crownCertainty = SeriesComparisonCrownCertaintyView(
        status = "no_target",
        bootstrapIterations = 0,
        successfulIterations = 0,
        leaderChangeCount = 0,
        shares = dataset.playerOrder.map(memberId =>
          SeriesComparisonCrownShareView(memberId.value, 0.0)
        ),
      ),
    )

  private def foldScoreView(score: RankFoldScore): SeriesComparisonRankFoldScoreView =
    SeriesComparisonRankFoldScoreView(
      fold = score.fold,
      heldEventCount = score.heldEventCount,
      comparisonCount = score.comparisonCount,
      baselineLogLoss = score.baselineLogLoss,
      fullLogLoss = score.fullLogLoss,
      baselineBrierScore = score.baselineBrierScore,
      fullBrierScore = score.fullBrierScore,
      fullModelImproved = score.fullModelImproved,
    )

  private def signalView(signal: PlayerRankSignal): SeriesComparisonRankSignalView =
    SeriesComparisonRankSignalView(
      signal = signalWire(signal.kind),
      direction = directionWire(signal.direction),
      importance = signal.importance,
      stable = signal.stable,
    )

  private def unexpectedWinView(win: UnexpectedWin): SeriesComparisonUnexpectedWinSummaryView =
    val incidents = win.row.incidents
    SeriesComparisonUnexpectedWinSummaryView(
      matchId = win.matchId.value,
      heldEventId = win.heldEventId.value,
      matchNoInEvent = win.matchNoInEvent,
      playedAt = DateTimeFormatter.ISO_INSTANT.format(win.row.playedAt),
      expectedRank = win.expectedRank,
      actualRank = win.row.rank.value,
      evidence = SeriesComparisonUnexpectedWinEvidenceView(
        revenueManYen = win.row.revenueManYen.value,
        destinationCount = incidents.destination,
        plusStationCount = incidents.plusStation,
        minusStationCount = incidents.minusStation,
        cardStationCount = incidents.cardStation,
        cardShopCount = incidents.cardShop,
        ginjiCount = incidents.suriNoGinji,
      ),
    )

  private def signalStatus(
      quality: RankAnalysisQuality,
      player: PlayerRankSignals,
  ): String =
    if quality == RankAnalysisQuality.NoTarget || player.signals.isEmpty then "no_target"
    else if quality == RankAnalysisQuality.Ok && player.signals.exists(_.stable) then "ok"
    else "reference"

  private def unexpectedWinStatus(
      quality: RankAnalysisQuality,
      totalWinCount: Int,
  ): String =
    if quality == RankAnalysisQuality.NoTarget || totalWinCount == 0 then "no_target"
    else if totalWinCount < 10 then "reference"
    else qualityWire(quality)

  private def qualityWire(quality: RankAnalysisQuality): String = quality match
    case RankAnalysisQuality.Ok => "ok"
    case RankAnalysisQuality.Reference => "reference"
    case RankAnalysisQuality.NoTarget => "no_target"

  private def reasonWire(reason: RankAnalysisReason): String = reason match
    case RankAnalysisReason.InsufficientEvents => "insufficient_events"
    case RankAnalysisReason.InsufficientMatches => "insufficient_matches"
    case RankAnalysisReason.InvalidDataset => "invalid_dataset"
    case RankAnalysisReason.NumericalFailure => "calculation_failed"
    case RankAnalysisReason.ModelNotBetter => "model_not_better"
    case RankAnalysisReason.UnstableSignals => "unstable_signals"

  private def signalWire(signal: RankSignalKind): String = signal match
    case RankSignalKind.Revenue => "revenue"
    case RankSignalKind.Destination => "destination"
    case RankSignalKind.PlusStation => "plus_station"
    case RankSignalKind.MinusStation => "minus_station"
    case RankSignalKind.CardStation => "card_station"
    case RankSignalKind.CardShop => "card_shop"
    case RankSignalKind.Ginji => "ginji"

  private def directionWire(direction: RankSignalDirection): String = direction match
    case RankSignalDirection.MoreIsHigher => "more_is_higher"
    case RankSignalDirection.LessIsHigher => "less_is_higher"

end SeriesComparisonRankAnalysisPresenter
