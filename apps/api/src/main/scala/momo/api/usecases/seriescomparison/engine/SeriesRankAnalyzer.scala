package momo.api.usecases.seriescomparison.engine

import momo.api.domain.ids.MemberId

private[seriescomparison] object SeriesRankAnalyzer:
  val ModelVersion = "rank-bt-v1"

  def analyze(dataset: SeriesDataset): RankAnalysisResult =
    analyze(dataset, RankAnalysisConfig.production)

  def analyze(
      dataset: SeriesDataset,
      config: RankAnalysisConfig,
  ): RankAnalysisResult =
    val heldEventCount = dataset.orderedRows.map(_.heldEventId).distinct.size
    val initialAssessment = RankAnalysisQualityPolicy.assess(
      heldEventCount,
      dataset.matchCount,
      improvedFoldCount = 0,
      hasStableSignal = false,
    )
    if initialAssessment._1 == RankAnalysisQuality.NoTarget then
      emptyResult(dataset, heldEventCount, initialAssessment._1, initialAssessment._2)
    else
      val analysis =
        for
          events <- RankFeatureEncoder.encode(dataset)
          evaluations <- RankCrossValidation.evaluate(events, config)
          rankSignals <- RankCrossValidation.rankSignals(
            evaluations,
            dataset.playerOrder.toVector,
            config,
          )
          expectedRanks <- RankCrossValidation.expectedRanks(evaluations)
          crown <- RankBlockBootstrap.crownCertainty(
            events,
            dataset.playerOrder.toVector,
            config,
          )
        yield buildResult(
          dataset,
          heldEventCount,
          evaluations,
          rankSignals,
          expectedRanks,
          crown,
        )
      analysis.fold(
        reason =>
          emptyResult(
            dataset,
            heldEventCount,
            RankAnalysisQuality.NoTarget,
            Vector(reason),
          ),
        identity,
      )

  private def buildResult(
      dataset: SeriesDataset,
      heldEventCount: Int,
      evaluations: Vector[FoldRankEvaluation],
      rankSignals: Vector[PlayerRankSignals],
      expectedRanks: Map[(String, String), Double],
      crown: CrownCertainty,
  ): RankAnalysisResult =
    val improvedFoldCount = evaluations.count(_.score.fullModelImproved)
    val hasStableSignal = rankSignals.exists(_.signals.exists(_.stable))
    val (quality, reasons) = RankAnalysisQualityPolicy.assess(
      heldEventCount,
      dataset.matchCount,
      improvedFoldCount,
      hasStableSignal,
    )
    RankAnalysisResult(
      modelVersion = ModelVersion,
      quality = quality,
      reasons = reasons,
      heldEventCount = heldEventCount,
      matchCount = dataset.matchCount,
      improvedFoldCount = improvedFoldCount,
      foldScores = evaluations.map(_.score),
      rankSignals = rankSignals,
      unexpectedWins = unexpectedWins(dataset, expectedRanks),
      crownCertainty = crown,
    )

  private def unexpectedWins(
      dataset: SeriesDataset,
      expectedRanks: Map[(String, String), Double],
  ): Vector[PlayerUnexpectedWins] = dataset.playerOrder.toVector.map { memberId =>
    val rows = dataset.rowsByPlayer.getOrElse(memberId, Nil)
    val wins = rows.filter(_.rank.value == 1)
    val unexpected = wins.flatMap { row =>
      expectedRanks.get((row.matchId.value, row.memberId.value))
        .filter(_ >= 2.5).map { expectedRank =>
          UnexpectedWin(
            matchId = row.matchId,
            heldEventId = row.heldEventId,
            matchNoInEvent = row.matchNoInEvent.value,
            playedAtEpochMilli = row.playedAt.toEpochMilli,
            memberId = row.memberId,
            expectedRank = expectedRank,
            row = row,
          )
        }
    }.sortBy(entry =>
      (entry.playedAtEpochMilli, entry.heldEventId.value, entry.matchNoInEvent, entry.matchId.value)
    ).toVector
    PlayerUnexpectedWins(memberId, wins.size, unexpected)
  }

  private def emptyResult(
      dataset: SeriesDataset,
      heldEventCount: Int,
      quality: RankAnalysisQuality,
      reasons: Vector[RankAnalysisReason],
  ): RankAnalysisResult = RankAnalysisResult(
    modelVersion = ModelVersion,
    quality = quality,
    reasons = reasons,
    heldEventCount = heldEventCount,
    matchCount = dataset.matchCount,
    improvedFoldCount = 0,
    foldScores = Vector.empty,
    rankSignals =
      dataset.playerOrder.toVector.map(memberId => PlayerRankSignals(memberId, Vector.empty)),
    unexpectedWins = dataset.playerOrder.toVector.map(memberId =>
      PlayerUnexpectedWins(memberId, totalWinCount(dataset, memberId), Vector.empty)
    ),
    crownCertainty = CrownCertainty(
      bootstrapIterations = 0,
      successfulIterations = 0,
      leaderChangeCount = 0,
      shares = dataset.playerOrder.toVector.map(memberId => CrownShare(memberId, 0.0)),
    ),
  )

  private def totalWinCount(dataset: SeriesDataset, memberId: MemberId): Int =
    dataset.rowsByPlayer.getOrElse(memberId, Nil).count(_.rank.value == 1)

end SeriesRankAnalyzer
