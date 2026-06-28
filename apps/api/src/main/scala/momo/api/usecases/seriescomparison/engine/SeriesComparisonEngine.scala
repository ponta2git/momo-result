package momo.api.usecases.seriescomparison.engine

import momo.api.domain.constraints.BoundaryConstraints.MetricIdString
import momo.api.domain.ids.{MatchId, MemberId}
import momo.api.domain.{
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonPlayerOrder,
  SeriesComparisonResolvedScope
}

final case class SeriesDataset(
    scope: SeriesComparisonResolvedScope,
    orderedRows: List[SeriesComparisonMatchPlayerRow],
    matchOrder: List[MatchId],
    playerOrder: List[MemberId],
):
  val matchCount: Int = matchOrder.size
  val playerCount: Int = playerOrder.size
  val matchIndexById: Map[MatchId, Int] = matchOrder.zipWithIndex.map {
    case (matchId, index) => matchId -> (index + 1)
  }.toMap
  val rowsByPlayer: Map[MemberId, List[SeriesComparisonMatchPlayerRow]] =
    orderedRows.groupBy(_.memberId)

enum SampleStatus derives CanEqual:
  case Ok
  case Empty
  case Insufficient
  case NoDenominator
  case Tied

enum MetricDirection derives CanEqual:
  case HigherIsBetter
  case LowerIsBetter
  case Neutral

final case class MetricDefinition(
    id: MetricIdString,
    label: String,
    formula: String,
    direction: MetricDirection,
    minimumSampleSize: Int,
)

final case class MetricEvidence(key: String, value: String)

final case class MetricResult[A](
    definition: MetricDefinition,
    status: SampleStatus,
    valuesByPlayer: Map[MemberId, A],
    evidence: List[MetricEvidence],
)

object SeriesComparisonEngine:
  def dataset(
      scope: SeriesComparisonResolvedScope,
      rows: List[SeriesComparisonMatchPlayerRow],
  ): SeriesDataset =
    val orderedRows = rows.sortBy(rowSortKey)
    val matchOrder = orderedRows.groupBy(_.matchId).values.toList.sortBy(matchGroupSortKey)
      .map(_.head.matchId)
    val playerOrder = orderedRows.groupBy(_.memberId).values.toList
      .map(_.head).sortBy(SeriesComparisonPlayerOrder.rowSortKey).map(_.memberId)
    SeriesDataset(scope, orderedRows, matchOrder, playerOrder)

  private def rowSortKey(row: SeriesComparisonMatchPlayerRow): (Long, String, Int, String, Int) =
    (
      row.playedAt.toEpochMilli,
      row.heldEventId.value,
      row.matchNoInEvent.value,
      row.matchId.value,
      row.playOrder.value,
    )

  private def matchGroupSortKey(rows: List[SeriesComparisonMatchPlayerRow]) =
    val first = rows.head
    (
      first.playedAt.toEpochMilli,
      first.heldEventId.value,
      first.matchNoInEvent.value,
      first.matchId.value
    )
