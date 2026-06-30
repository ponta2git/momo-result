package momo.api.usecases.seriescomparison

import momo.api.usecases.seriescomparison.engine.SeriesDataset
import momo.api.usecases.seriescomparison.view.*

private[usecases] object SeriesComparisonReviewAggregation
    extends SeriesComparisonReviewRevenueCandidate
    with SeriesComparisonReviewDestinationPositiveCandidate
    with SeriesComparisonReviewDestinationZeroCandidate
    with SeriesComparisonReviewAccidentCandidate
    with SeriesComparisonReviewLowAssetCandidate
    with SeriesComparisonReviewPlayOrderCandidate
    with SeriesComparisonReviewRecoveryCandidate
    with SeriesComparisonReviewGinjiCandidate:
  private val SchemaVersion = 4

  def aggregate(
      dataset: SeriesDataset
  ): SeriesComparisonReviewView =
    val scope = dataset.scope
    val orderedRows = dataset.orderedRows
    val matchGroups = matchGroupsFrom(orderedRows)
    val playerOrder = dataset.playerOrder
    val statsByPlayer = playerOrder.map(memberId =>
      memberId -> PlayerStats.fromRows(memberId, rowsByPlayer(orderedRows, memberId), orderedRows)
    ).toMap
    val allCandidates = playerOrder
      .flatMap(memberId => playbookCandidates(statsByPlayer(memberId), orderedRows))
    val scoredCandidates = SeriesComparisonPlaybookScoring.score(allCandidates)
    val commonTopics = SeriesComparisonPlaybookScoring.commonTopics(scoredCandidates)
    val playbook = playerOrder.map(memberId =>
      val stats = statsByPlayer(memberId)
      SeriesComparisonPlayerPlaybookView(
        memberId = memberId.value,
        memberDisplayName = stats.displayName,
        cards = SeriesComparisonPlaybookScoring.cardsFor(memberId, scoredCandidates),
      )
    )
    SeriesComparisonReviewView(
      schemaVersion = SchemaVersion,
      baseline = SeriesComparisonReviewBaselineView(
        scope = scopeView(scope),
        matchCount = matchGroups.size,
        playerCount = playerOrder.size,
        status = normalStatus(matchGroups.size, Thresholds.MainNormalSample),
        supplementalScopeName = None,
      ),
      commonPlaybookTopics = commonTopics,
      playbookByPlayer = playbook,
      dataQuality = SeriesComparisonDataQualityView(
        SeriesComparisonPlaybookScoring.dataQualityItems(playbook)
      ),
    )
