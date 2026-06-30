package momo.api.usecases.seriescomparison

import momo.api.domain.ids.MemberId
import momo.api.domain.{SeriesComparisonMatchPlayerRow, SeriesComparisonResolvedScope}
import momo.api.usecases.seriescomparison.view.*

private[seriescomparison] trait SeriesComparisonReviewCommonSupport
    extends SeriesComparisonReviewStatsSupport:

  protected def revenueTopCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]
  protected def destinationPositiveCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]
  protected def destinationZeroCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]
  protected def accidentAnyCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]
  protected def lowAssetCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]
  protected def playOrderCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]
  protected def recoveryCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]
  protected def ginjiCandidate(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): Option[PlaybookCandidate]

  protected final def rowsByPlayer(
      rows: List[SeriesComparisonMatchPlayerRow],
      memberId: MemberId,
  ): List[SeriesComparisonMatchPlayerRow] = rows.filter(_.memberId == memberId)

  protected final def scopeView(scope: SeriesComparisonResolvedScope): SeriesComparisonScopeView =
    SeriesComparisonScopeView(
      gameTitleId = scope.gameTitleId.value,
      gameTitleName = scope.gameTitleName,
      layoutFamily = scope.layoutFamily,
      scopeKind = scope.scopeKind,
      scopeId = scope.scopeId,
      scopeName = scope.scopeName,
      seasonMasterId = scope.seasonMasterId.map(_.value),
      seasonName = scope.seasonName,
      mapMasterId = scope.mapMasterId.map(_.value),
      mapName = scope.mapName,
    )

  protected final case class MatchGroup(matchIndex: Int, rows: List[SeriesComparisonMatchPlayerRow]):
    val matchId = rows.head.matchId
    val playedAt = rows.head.playedAt
    val heldEventId = rows.head.heldEventId
    val matchNoInEvent = rows.head.matchNoInEvent

  protected final def matchGroupsFrom(rows: List[SeriesComparisonMatchPlayerRow]): List[MatchGroup] = rows
    .groupBy(_.matchId).values.toList.sortBy(groupSortKey).zipWithIndex.map { case (group, index) =>
      MatchGroup(index + 1, sortedRows(group))
    }

  protected final def groupSortKey(rows: List[SeriesComparisonMatchPlayerRow]) =
    val first = rows.head
    (first.playedAt, first.heldEventId.value, first.matchNoInEvent.value, first.matchId.value)

  protected final def sortedRows(rows: List[SeriesComparisonMatchPlayerRow]) = rows.sortBy(row =>
    (
      row.playedAt,
      row.heldEventId.value,
      row.matchNoInEvent.value,
      row.matchId.value,
      row.playOrder.value,
    )
  )

  protected final def playbookCandidates(
      stats: PlayerStats,
      allRows: List[SeriesComparisonMatchPlayerRow],
  ): List[PlaybookCandidate] = List(
    revenueTopCandidate(stats, allRows),
    destinationPositiveCandidate(stats, allRows),
    destinationZeroCandidate(stats, allRows),
    accidentAnyCandidate(stats, allRows),
    lowAssetCandidate(stats, allRows),
    playOrderCandidate(stats, allRows),
    recoveryCandidate(stats, allRows),
    ginjiCandidate(stats, allRows),
  ).flatten

  protected final def playbookCandidate(
      stats: PlayerStats,
      card: SeriesComparisonPlaybookCardView,
      peerEffectValue: Double,
  ): PlaybookCandidate = PlaybookCandidate(
    memberId = stats.memberId,
    memberDisplayName = stats.displayName,
    card = card.copy(id = s"${stats.memberId.value}.${card.id}"),
    peerEffectValue = peerEffectValue,
    baseScore = card.actionAdviceScore,
  )

