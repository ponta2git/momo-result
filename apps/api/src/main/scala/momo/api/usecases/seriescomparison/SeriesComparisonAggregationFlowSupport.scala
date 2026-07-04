package momo.api.usecases.seriescomparison

import cats.syntax.all.*

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonAggregationFlowSupport
    extends SeriesComparisonAggregationCommonSupport:
  this: SeriesComparisonAggregationAllSupport =>

  protected final def trends(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): SeriesComparisonTrendsView =
    def series(value: (SeriesComparisonMatchPlayerRow, Int) => Double): List[TrendSeriesView] =
      playerOrder.map { memberId =>
        val rows = rowsByPlayer.getOrElse(memberId, Nil).sortBy(row =>
          (
            row.playedAt.toEpochMilli,
            row.heldEventId.value,
            row.matchNoInEvent.value,
            row.matchId.value,
          )
        )
        TrendSeriesView(
          memberId = memberId.value,
          points = rows.zipWithIndex.map { case (row, idx) =>
            TrendPointView(
              index = idx + 1,
              matchId = row.matchId.value,
              playedAt = Formatter.format(row.playedAt),
              value = Some(value(row, idx + 1)),
            )
          },
        )
      }
    SeriesComparisonTrendsView(
      rankCumulativeAverage = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        averageUnsafe(rows.map(row => asDecimal(row.rank.value)))
      },
      rankCumulativeStandardDeviation = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        stddev(rows.map(row => asDecimal(row.rank.value))).getOrElse(0.0)
      },
      podiumCumulativeRate = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        asDecimal(rows.count(r => r.rank.value <= 2)) / asDecimal(idx)
      },
      lowerHalfCumulativeRate = series { (row, idx) =>
        val rows = rowsByPlayer(row.memberId).take(idx)
        asDecimal(rows.count(r => r.rank.value >= 3)) / asDecimal(idx)
      },
      ginjiCumulativeCount = series { (row, idx) =>
        asDecimal(rowsByPlayer(row.memberId).take(idx).map(_.incidents.suriNoGinji).sum)
      },
    )

  protected final def headToHead(
      playerOrder: List[MemberId],
      rows: List[SeriesComparisonMatchPlayerRow],
  ): HeadToHeadView =
    val rowsByMatchAndPlayer = rows.map(row => (row.matchId, row.memberId) -> row).toMap
    HeadToHeadView(entries = playerOrder.flatMap { subjectId =>
      playerOrder.map { opponentId =>
        if subjectId == opponentId then
          HeadToHeadEntryView(
            subjectMemberId = subjectId.value,
            opponentMemberId = opponentId.value,
            matchCount = 0,
            sampleMaturity = sampleMaturity(0),
            betterRankCount = 0,
            betterRankRate = None,
            averageRankDiff = None,
            averageAssetsDiff = None,
            status = "self",
            headToHeadSignal = "self",
          )
        else
          val pairs = rows.filter(_.memberId == subjectId).flatMap(subject =>
            rowsByMatchAndPlayer.get((subject.matchId, opponentId))
              .map(opponent => subject -> opponent)
          )
          val matchCount = pairs.size
          val betterRankCount = pairs.count { case (subject, opponent) =>
            subject.rank.value < opponent.rank.value
          }
          val betterRankRate = rate(betterRankCount, matchCount)
          val averageRankDiff = average(pairs.map { case (subject, opponent) =>
            asDecimal(opponent.rank.value - subject.rank.value)
          })
          val averageAssetsDiff = average(pairs.map { case (subject, opponent) =>
            asDecimal(subject.totalAssetsManYen.value - opponent.totalAssetsManYen.value)
          })
          val status = normalStatus(matchCount)
          HeadToHeadEntryView(
            subjectMemberId = subjectId.value,
            opponentMemberId = opponentId.value,
            matchCount = matchCount,
            sampleMaturity = sampleMaturity(matchCount),
            betterRankCount = betterRankCount,
            betterRankRate = betterRankRate,
            averageRankDiff = averageRankDiff,
            averageAssetsDiff = averageAssetsDiff,
            status = status,
            headToHeadSignal = headToHeadSignal(
              matchCount,
              betterRankRate,
              averageRankDiff,
              status,
            ),
          )
      }
    })

  protected final def matchPlayerPoints(
      rows: List[SeriesComparisonMatchPlayerRow],
      matchIndexById: Map[momo.api.domain.ids.MatchId, Int],
      revenueRanks: Map[(String, String), Double],
      assetsRanks: Map[(String, String), Double],
  ): List[MatchPlayerPointView] = rows.map(row =>
    MatchPlayerPointView(
      matchIndex = matchIndexById.getOrElse(row.matchId, 0),
      matchId = row.matchId.value,
      playedAt = Formatter.format(row.playedAt),
      memberId = row.memberId.value,
      rank = row.rank.value,
      totalAssets = row.totalAssetsManYen.value,
      revenue = row.revenueManYen.value,
      revenueAssetRate = revenueAssetRate(row),
      assetsRank = assetsRanks.getOrElse(rankKey(row), 0.0),
      revenueRank = revenueRanks.getOrElse(rankKey(row), 0.0),
    )
  )

  protected final def recentFormByPlayer(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): List[RecentFormPlayerView] =
    val windowSize = Thresholds.RecentFormWindowSize
    playerOrder.map { memberId =>
      val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
      val recent = rows.takeRight(windowSize)
      RecentFormPlayerView(
        memberId = memberId.value,
        windowSize = windowSize,
        targetCount = recent.size,
        averageRank = average(recent.map(row => asDecimal(row.rank.value))),
        podiumRate = rate(recent.count(_.rank.value <= 2), recent.size),
        winStreak = suffixStreak(rows, _.rank.value == 1),
        podiumStreak = suffixStreak(rows, _.rank.value <= 2),
        lowerHalfStreak = suffixStreak(rows, _.rank.value >= 3),
        status = normalStatus(recent.size),
      )
    }

  protected final def momentumSwitchByPlayer(
      playerOrder: List[MemberId],
      rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]],
  ): MomentumSwitchView = MomentumSwitchView(playerOrder.map { memberId =>
    val rows = sortedPlayerRows(rowsByPlayer.getOrElse(memberId, Nil))
    val transitions = rankTransitions(rows)
    val podiumBaseline = rate(rows.count(_.rank.value <= 2), rows.size)
    val lowerHalfBaseline = rate(rows.count(_.rank.value >= 3), rows.size)
    MomentumSwitchPlayerView(
      memberId = memberId.value,
      denominator = rows.size,
      transitionCount = transitions.size,
      afterLower = momentumSwitchRate(
        kind = "afterLower",
        transitions = transitions,
        previousMatches = _.rank.value >= 3,
        currentMatches = _.rank.value <= 2,
        baselineRate = podiumBaseline,
      ),
      afterFourth = momentumSwitchRate(
        kind = "afterFourth",
        transitions = transitions,
        previousMatches = _.rank.value == 4,
        currentMatches = _.rank.value <= 2,
        baselineRate = podiumBaseline,
      ),
      afterPodium = momentumSwitchRate(
        kind = "afterPodium",
        transitions = transitions,
        previousMatches = _.rank.value <= 2,
        currentMatches = _.rank.value >= 3,
        baselineRate = lowerHalfBaseline,
      ),
      transitionRows = momentumSwitchTransitionRows(transitions),
    )
  })

  protected final def momentumSwitchRate(
      kind: String,
      transitions: List[RankTransition],
      previousMatches: SeriesComparisonMatchPlayerRow => Boolean,
      currentMatches: SeriesComparisonMatchPlayerRow => Boolean,
      baselineRate: Option[Double],
  ): MomentumSwitchRateView =
    val targets = transitions.filter(transition => previousMatches(transition.previous))
    val successCount = targets.count(transition => currentMatches(transition.current))
    val switchRate = rate(successCount, targets.size)
    val deltaFromBaseline = (switchRate, baselineRate).mapN(_ - _)
    val status = momentumSwitchStatus(targets.size)
    MomentumSwitchRateView(
      targetCount = targets.size,
      sampleMaturity = sampleMaturity(targets.size),
      successCount = successCount,
      rate = switchRate,
      baselineRate = baselineRate,
      deltaFromBaseline = deltaFromBaseline,
      status = status,
      momentumSwitchSignal = momentumSwitchSignal(kind, deltaFromBaseline, status),
    )

  protected final def momentumSwitchTransitionRows(
      transitions: List[RankTransition]
  ): List[MomentumSwitchTransitionRowView] = (1 to 4).toList.map { previousRank =>
    val targets = transitions.filter(_.previous.rank.value == previousRank)
    val targetCount = targets.size
    MomentumSwitchTransitionRowView(
      previousRank = previousRank,
      targetCount = targetCount,
      status = momentumSwitchStatus(targetCount),
      cells = (1 to 4).toList.map { nextRank =>
        val count = targets.count(_.current.rank.value == nextRank)
        MomentumSwitchTransitionCellView(
          nextRank = nextRank,
          count = count,
          rate = rate(count, targetCount),
        )
      },
    )
  }

  protected final case class RankTransition(
      previous: SeriesComparisonMatchPlayerRow,
      current: SeriesComparisonMatchPlayerRow,
  )

  protected final def rankTransitions(rows: List[SeriesComparisonMatchPlayerRow])
      : List[RankTransition] =
    rows.sliding(2).collect { case List(previous, current) => RankTransition(previous, current) }
      .toList
