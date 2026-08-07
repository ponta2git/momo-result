package momo.api.usecases.seriescomparison

import java.time.format.DateTimeFormatter

import scala.util.Try

import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.engine.*
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] final case class RankAnalysisDrilldownPresentation(
    rankSignals: SeriesComparisonRankSignalsDrilldownPayloadView,
    unexpectedWins: SeriesComparisonUnexpectedWinsDrilldownPayloadView,
)

private[seriescomparison] object SeriesComparisonRankAnalysisDrilldownPresenter:
  private val Formatter = DateTimeFormatter.ISO_INSTANT

  def analyze(
      dataset: SeriesDataset,
      memberId: MemberId,
  ): RankAnalysisDrilldownPresentation = Try(
    SeriesRankAnalyzer.analyzeForDrilldown(dataset)
  ).fold(
    _ => calculationFailed(dataset, memberId),
    result => present(dataset, memberId, result),
  )

  private def present(
      dataset: SeriesDataset,
      memberId: MemberId,
      result: RankAnalysisResult,
  ): RankAnalysisDrilldownPresentation =
    val playerSignals = result.rankSignals.find(_.memberId == memberId)
      .getOrElse(PlayerRankSignals(memberId, Vector.empty))
    val playerUnexpectedWins = result.unexpectedWins.find(_.memberId == memberId)
      .getOrElse(PlayerUnexpectedWins(memberId, 0, Vector.empty))
    val reasonCodes = result.reasons.map(SeriesComparisonRankAnalysisPresenter.reasonWire).toList
    RankAnalysisDrilldownPresentation(
      rankSignals = SeriesComparisonRankSignalsDrilldownPayloadView(
        status = SeriesComparisonRankAnalysisPresenter.signalStatus(result.quality, playerSignals),
        reasonCodes = reasonCodes,
        heldEventCount = result.heldEventCount,
        matchCount = result.matchCount,
        improvedFoldCount = result.improvedFoldCount,
        signals = playerSignals.signals.map { signal =>
          SeriesComparisonRankSignalDetailView(
            signal = SeriesComparisonRankAnalysisPresenter.signalWire(signal.kind),
            direction = SeriesComparisonRankAnalysisPresenter.directionWire(signal.direction),
            importance = signal.importance,
            stable = signal.stable,
            foldRows = signal.foldImportances.zipWithIndex.map { case (importance, index) =>
              val score = result.foldScores.lift(index)
              SeriesComparisonRankSignalFoldRowView(
                fold = score.map(_.fold).getOrElse(index),
                heldEventCount = score.map(_.heldEventCount).getOrElse(0),
                comparisonCount = signal.foldComparisonCounts.lift(index).getOrElse(0),
                importance = importance,
              )
            }.toList,
          )
        }.toList,
      ),
      unexpectedWins = SeriesComparisonUnexpectedWinsDrilldownPayloadView(
        status = SeriesComparisonRankAnalysisPresenter.unexpectedWinStatus(
          result.quality,
          playerUnexpectedWins.totalWinCount,
        ),
        reasonCodes = reasonCodes,
        heldEventCount = result.heldEventCount,
        matchCount = result.matchCount,
        totalWinCount = playerUnexpectedWins.totalWinCount,
        unexpectedWinCount = playerUnexpectedWins.wins.size,
        rows = playerUnexpectedWins.wins.map { win =>
          val incidents = win.row.incidents
          SeriesComparisonUnexpectedWinDrilldownRowView(
            matchIndex = dataset.matchIndexById.getOrElse(win.matchId, 0),
            matchId = win.matchId.value,
            heldEventId = win.heldEventId.value,
            matchNoInEvent = win.matchNoInEvent,
            playedAt = Formatter.format(win.row.playedAt),
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
        }.toList,
      ),
    )

  private def calculationFailed(
      dataset: SeriesDataset,
      memberId: MemberId,
  ): RankAnalysisDrilldownPresentation =
    val heldEventCount = dataset.orderedRows.map(_.heldEventId).distinct.size
    val totalWinCount = dataset.rowsByPlayer.getOrElse(memberId, Nil).count(_.rank.value == 1)
    RankAnalysisDrilldownPresentation(
      rankSignals = SeriesComparisonRankSignalsDrilldownPayloadView(
        status = "no_target",
        reasonCodes = List("calculation_failed"),
        heldEventCount = heldEventCount,
        matchCount = dataset.matchCount,
        improvedFoldCount = 0,
        signals = Nil,
      ),
      unexpectedWins = SeriesComparisonUnexpectedWinsDrilldownPayloadView(
        status = "no_target",
        reasonCodes = List("calculation_failed"),
        heldEventCount = heldEventCount,
        matchCount = dataset.matchCount,
        totalWinCount = totalWinCount,
        unexpectedWinCount = 0,
        rows = Nil,
      ),
    )

end SeriesComparisonRankAnalysisDrilldownPresenter
