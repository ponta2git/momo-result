package momo.api.usecases.seriescomparison.engine

import momo.api.domain.SeriesComparisonMatchPlayerRow
import momo.api.domain.ids.MemberId

private[seriescomparison] object RankFeatureEncoder:
  private val PlayerCount = 4
  private val PlayOrderCount = 4

  def encode(dataset: SeriesDataset): Either[RankAnalysisReason, Vector[EncodedRankEvent]] =
    val playerIndex = dataset.playerOrder.zipWithIndex.toMap
    val rowsByMatch = dataset.orderedRows.groupBy(_.matchId)
    val encodedMatches = dataset.matchOrder.foldLeft[
      Either[RankAnalysisReason, Vector[EncodedRankMatch]]
    ](Right(Vector.empty)) { (accumulated, matchId) =>
      for
        matches <- accumulated
        rows = rowsByMatch.getOrElse(matchId, Nil).toVector.sortBy(row =>
          playerIndex.getOrElse(row.memberId, Int.MaxValue)
        )
        encoded <- encodeMatch(rows, playerIndex, dataset.playerCount)
      yield matches :+ encoded
    }

    encodedMatches.flatMap { matches =>
      val grouped = matches.groupBy(_.rows.head.source.heldEventId).toVector
        .map { case (heldEventId, eventMatches) =>
          val orderedMatches = eventMatches.sortBy(matchSortKey)
          EncodedRankEvent(
            heldEventId = heldEventId,
            playedAtEpochMilli = orderedMatches.head.rows.head.source.playedAt.toEpochMilli,
            matches = orderedMatches,
          )
        }.sortBy(event => (event.playedAtEpochMilli, event.heldEventId.value))
      if grouped.nonEmpty then Right(grouped) else Left(RankAnalysisReason.InvalidDataset)
    }

  def pairRecords(events: Vector[EncodedRankEvent]): Vector[PairwiseRankRecord] =
    events.flatMap { event =>
      event.matches.flatMap { rankMatch =>
        rankMatch.rows.indices.flatMap { leftIndex =>
          ((leftIndex + 1) until rankMatch.rows.size).map { rightIndex =>
            val left = rankMatch.rows(leftIndex)
            val right = rankMatch.rows(rightIndex)
            pairRecord(event.heldEventId, rankMatch.matchId, left, right)
          }
        }
      }
    }

  def withPermutedSignal(
      events: Vector[EncodedRankEvent],
      memberId: MemberId,
      signalIndex: Int,
  ): Vector[EncodedRankEvent] =
    if events.size <= 1 then events
    else
      val donorsByEvent = events.indices.map { eventIndex =>
        val donorEvent = events((eventIndex + 1) % events.size)
        val donorValues = rowsForMember(donorEvent, memberId).map(_.signalFeatures(signalIndex))
        events(eventIndex).heldEventId -> donorValues
      }.toMap
      events.map { event =>
        val donorValues = donorsByEvent.getOrElse(event.heldEventId, Vector.empty)
        val memberRows = rowsForMember(event, memberId)
        val replacementByMatch = memberRows.zipWithIndex.map { case (row, index) =>
          val replacement = donorValues.lift(index % donorValues.size)
            .getOrElse(row.signalFeatures(signalIndex))
          row.source.matchId -> replacement
        }.toMap
        event.copy(matches = event.matches.map { rankMatch =>
          rankMatch.copy(rows = rankMatch.rows.map { row =>
            if row.source.memberId == memberId then
              row.copy(signalFeatures =
                row.signalFeatures.updated(
                  signalIndex,
                  replacementByMatch.getOrElse(rankMatch.matchId, row.signalFeatures(signalIndex)),
                )
              )
            else row
          })
        })
      }

  private def encodeMatch(
      rows: Vector[SeriesComparisonMatchPlayerRow],
      playerIndex: Map[MemberId, Int],
      playerCount: Int,
  ): Either[RankAnalysisReason, EncodedRankMatch] =
    val valid = rows.size == PlayerCount && playerCount == PlayerCount &&
      rows.map(_.memberId).distinct.size == PlayerCount &&
      rows.map(_.rank.value).sorted == Vector(1, 2, 3, 4) &&
      rows.map(_.heldEventId).distinct.size == 1 &&
      rows.map(_.matchId).distinct.size == 1 &&
      rows.forall(row => playerIndex.contains(row.memberId))
    if !valid then Left(RankAnalysisReason.InvalidDataset)
    else
      val rawBySignal = RankSignalKind.valuesInFeatureOrder.indices.map { signalIndex =>
        rows.map(row => rawSignal(row, signalIndex))
      }.toVector
      val encodedRows = rows.zipWithIndex.map { case (row, rowIndex) =>
        val signals = rawBySignal.map(values => relativeRank(values, rowIndex))
        val playOrder = oneHot(row.playOrder.value - 1, PlayOrderCount)
        val member = oneHot(playerIndex(row.memberId), playerCount)
        EncodedRankRow(row, signals, playOrder ++ member)
      }
      Right(EncodedRankMatch(rows.head.matchId, encodedRows))

  private def pairRecord(
      heldEventId: momo.api.domain.ids.HeldEventId,
      matchId: momo.api.domain.ids.MatchId,
      left: EncodedRankRow,
      right: EncodedRankRow,
  ): PairwiseRankRecord =
    val outcome = if left.source.rank.value < right.source.rank.value then 1.0 else 0.0
    PairwiseRankRecord(
      heldEventId = heldEventId,
      matchId = matchId,
      left = left,
      right = right,
      fullObservation = PairwiseRankObservation(
        difference(left.fullFeatures, right.fullFeatures),
        outcome,
      ),
      baselineObservation = PairwiseRankObservation(
        difference(left.adjustmentFeatures, right.adjustmentFeatures),
        outcome,
      ),
    )

  private def rowsForMember(
      event: EncodedRankEvent,
      memberId: MemberId,
  ): Vector[EncodedRankRow] = event.matches.flatMap(_.rows.filter(_.source.memberId == memberId))

  private def rawSignal(row: SeriesComparisonMatchPlayerRow, signalIndex: Int): Double =
    signalIndex match
      case 0 => row.revenueManYen.value * 1.0
      case 1 => row.incidents.destination * 1.0
      case 2 => row.incidents.plusStation * 1.0
      case 3 => row.incidents.minusStation * 1.0
      case 4 => row.incidents.cardStation * 1.0
      case 5 => row.incidents.cardShop * 1.0
      case _ => row.incidents.suriNoGinji * 1.0

  private def relativeRank(values: Vector[Double], targetIndex: Int): Double =
    val target = values(targetIndex)
    val greaterCount = values.count(_ > target)
    val tiedCount = values.count(_ == target)
    val averageRank = greaterCount + 1.0 + (tiedCount - 1) / 2.0
    (2.5 - averageRank) / 1.5

  private def oneHot(index: Int, size: Int): Vector[Double] =
    Vector.tabulate(size)(candidate => if candidate == index then 1.0 else 0.0)

  private def difference(left: Vector[Double], right: Vector[Double]): Vector[Double] =
    left.zip(right).map { case (leftValue, rightValue) => leftValue - rightValue }

  private def matchSortKey(rankMatch: EncodedRankMatch): (Long, Int, String) =
    val row = rankMatch.rows.head.source
    (row.playedAt.toEpochMilli, row.matchNoInEvent.value, row.matchId.value)

end RankFeatureEncoder
