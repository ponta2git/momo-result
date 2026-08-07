package momo.api.usecases.seriescomparison.engine

import java.time.Instant

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{
  ManYen,
  MatchNoInEvent,
  PlayOrder,
  Rank,
  SeriesComparisonIncidentCountsRow,
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonResolvedScope
}

final class SeriesRankAnalyzerSpec extends FunSuite:
  private val playerIds = Vector("alpha", "bravo", "charlie", "delta")
  private val titleId = GameTitleId.unsafeFromString("title-rank-analysis")
  private val seasonId = SeasonMasterId.unsafeFromString("season-rank-analysis")
  private val mapId = MapMasterId.unsafeFromString("map-rank-analysis")
  private val start = Instant.parse("2026-01-01T00:00:00Z")
  private val testConfig = RankAnalysisConfig.production.copy(bootstrapIterations = 24)

  test("derives stable signals, out-of-fold surprises, and deterministic crown shares"):
    val rows = syntheticRows(heldEventCount = 20, matchesPerEvent = 2)
    val forward = SeriesRankAnalyzer.analyze(dataset(rows), testConfig)
    val reversed = SeriesRankAnalyzer.analyze(dataset(rows.reverse), testConfig)

    assertEquals(forward, reversed)
    assertEquals(forward.quality, RankAnalysisQuality.Ok)
    assertEquals(forward.heldEventCount, 20)
    assertEquals(forward.matchCount, 40)
    assert(forward.improvedFoldCount >= 4)
    assertEquals(forward.foldScores.map(_.fold), Vector(0, 1, 2, 3, 4))
    assert(forward.foldScores.forall(_.heldEventCount == 4))
    assert(forward.foldScores.forall(_.comparisonCount == 48))
    assert(forward.rankSignals.forall(_.signals.size <= 3))
    assert(forward.rankSignals.exists(_.signals.exists { signal =>
      signal.kind == RankSignalKind.Revenue &&
      signal.direction == RankSignalDirection.MoreIsHigher && signal.stable
    }))
    assert(forward.unexpectedWins.flatMap(_.wins).nonEmpty)
    assert(forward.unexpectedWins.flatMap(_.wins).forall(_.expectedRank >= 2.5))
    assertEquals(forward.crownCertainty.bootstrapIterations, 24)
    assertEquals(forward.crownCertainty.successfulIterations, 24)
    assertEqualsDouble(forward.crownCertainty.shares.map(_.share).sum, 1.0, 0.0000000001)

  test("keeps every held event in exactly one deterministic evaluation fold"):
    val encoded = RankFeatureEncoder.encode(dataset(syntheticRows(10, 4))) match
      case Right(value) => value
      case Left(reason) => fail(s"encoding failed: $reason")
    val evaluations = RankCrossValidation.evaluate(encoded, testConfig) match
      case Right(value) => value
      case Left(reason) => fail(s"evaluation failed: $reason")

    val evaluatedIds = evaluations.flatMap(_.testEvents.map(_.heldEventId.value))
    assertEquals(evaluatedIds.distinct.size, 10)
    assertEquals(evaluatedIds.size, 10)
    assertEquals(evaluations.map(_.testEvents.size), Vector(2, 2, 2, 2, 2))

  test("excludes total assets and uses tie-aware within-match signal ranks"):
    val originalRows = syntheticRows(1, 1)
    val changedAssets = originalRows.map(row =>
      row.copy(totalAssetsManYen = ManYen.unsafeFromInt(row.totalAssetsManYen.value * -100))
    )
    val original = encodedRows(originalRows)
    val changed = encodedRows(changedAssets)

    assertEquals(original.map(_.signalFeatures), changed.map(_.signalFeatures))
    assertEquals(original.map(_.signalFeatures.head), Vector(1.0, 1.0 / 3.0, -1.0 / 3.0, -1.0))
    assertEquals(original.map(_.signalFeatures(1)), Vector(0.0, 0.0, 0.0, 0.0))

  test("returns local no-target result for insufficient and malformed datasets"):
    val insufficient = SeriesRankAnalyzer.analyze(dataset(syntheticRows(7, 4)), testConfig)
    val malformedRows = syntheticRows(8, 4).filterNot { row =>
      row.matchId.value == "match-0-0" && row.memberId.value == "delta"
    }
    val malformed = SeriesRankAnalyzer.analyze(dataset(malformedRows), testConfig)

    assertEquals(insufficient.quality, RankAnalysisQuality.NoTarget)
    assert(insufficient.reasons.contains(RankAnalysisReason.InsufficientEvents))
    assert(insufficient.reasons.contains(RankAnalysisReason.InsufficientMatches))
    assertEquals(insufficient.foldScores, Vector.empty)
    assertEquals(malformed.quality, RankAnalysisQuality.NoTarget)
    assertEquals(malformed.reasons, Vector(RankAnalysisReason.InvalidDataset))
    assertEquals(malformed.foldScores, Vector.empty)

  test("fixes quality boundaries for events, matches, fold improvement, and stability"):
    val cases = List(
      (7, 31, 5, true, RankAnalysisQuality.NoTarget),
      (8, 32, 5, true, RankAnalysisQuality.Reference),
      (19, 32, 5, true, RankAnalysisQuality.Reference),
      (20, 32, 3, true, RankAnalysisQuality.Reference),
      (20, 32, 4, false, RankAnalysisQuality.Reference),
      (20, 32, 4, true, RankAnalysisQuality.Ok),
    )

    cases.foreach { case (events, matches, improved, stable, expected) =>
      val (quality, _) = RankAnalysisQualityPolicy.assess(events, matches, improved, stable)
      assertEquals(quality, expected)
    }

  private def encodedRows(rows: List[SeriesComparisonMatchPlayerRow]): Vector[EncodedRankRow] =
    RankFeatureEncoder.encode(dataset(rows)) match
      case Right(events) => events.flatMap(_.matches).flatMap(_.rows)
      case Left(reason) => fail(s"encoding failed: $reason")

  private def dataset(rows: List[SeriesComparisonMatchPlayerRow]): SeriesDataset =
    SeriesComparisonEngine.dataset(
      SeriesComparisonResolvedScope(
        gameTitleId = titleId,
        gameTitleName = "桃鉄2",
        layoutFamily = "momotetsu2",
        scopeKind = "overall",
        scopeId = None,
        scopeName = "総合",
      ),
      rows,
    )

  private def syntheticRows(
      heldEventCount: Int,
      matchesPerEvent: Int,
  ): List[SeriesComparisonMatchPlayerRow] =
    (0 until heldEventCount).toList.flatMap { eventIndex =>
      (0 until matchesPerEvent).toList.flatMap { matchIndex =>
        val sequence = eventIndex * matchesPerEvent + matchIndex
        val revenueOrder = playerIds.indices.sortBy(playerIndex =>
          -revenueFor(sequence, playerIndex)
        )
        val normalRankByPlayer = revenueOrder.zipWithIndex.map { case (playerIndex, rankIndex) =>
          playerIndex -> (rankIndex + 1)
        }.toMap
        val surpriseWinner = if sequence % 10 == 9 then Some(revenueOrder.last) else None
        val rankByPlayer = surpriseWinner.fold(normalRankByPlayer) { winnerIndex =>
          val withoutWinner = revenueOrder.filterNot(_ == winnerIndex)
          (Vector(winnerIndex) ++ withoutWinner).zipWithIndex.map {
            case (playerIndex, rankIndex) => playerIndex -> (rankIndex + 1)
          }.toMap
        }
        playerIds.indices.map { playerIndex =>
          row(
            eventIndex,
            matchIndex,
            sequence,
            playerIndex,
            rankByPlayer(playerIndex),
            revenueFor(sequence, playerIndex),
          )
        }
      }
    }

  private def revenueFor(sequence: Int, playerIndex: Int): Int =
    val relative = (playerIndex + sequence) % 4
    4000 - relative * 1000

  private def row(
      eventIndex: Int,
      matchIndex: Int,
      sequence: Int,
      playerIndex: Int,
      rankValue: Int,
      revenue: Int,
  ): SeriesComparisonMatchPlayerRow =
    val member = playerIds(playerIndex)
    SeriesComparisonMatchPlayerRow(
      matchId = MatchId.unsafeFromString(s"match-$eventIndex-$matchIndex"),
      playedAt = start.plusSeconds(sequence.toLong),
      heldEventId = HeldEventId.unsafeFromString(s"event-$eventIndex"),
      matchNoInEvent = MatchNoInEvent.unsafeFromInt(matchIndex + 1),
      gameTitleId = titleId,
      seasonMasterId = seasonId,
      mapMasterId = mapId,
      memberId = MemberId.unsafeFromString(member),
      memberDisplayName = member,
      playOrder = PlayOrder.unsafeFromInt((playerIndex + sequence) % 4 + 1),
      rank = Rank.unsafeFromInt(rankValue),
      totalAssetsManYen = ManYen.unsafeFromInt(5000 - rankValue * 500),
      revenueManYen = ManYen.unsafeFromInt(revenue),
      incidents = SeriesComparisonIncidentCountsRow(
        destination = 0,
        plusStation = (sequence + playerIndex) % 3,
        minusStation = 0,
        cardStation = 0,
        cardShop = 0,
        suriNoGinji = 0,
      ),
    )

end SeriesRankAnalyzerSpec
