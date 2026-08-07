package momo.api.usecases.seriescomparison

import momo.api.usecases.seriescomparison.engine.SeriesDataset
import momo.api.usecases.seriescomparison.view.*

private[usecases] object SeriesComparisonAggregation
    extends SeriesComparisonAggregationAllSupport:

  def aggregate(
      dataset: SeriesDataset
  ): SeriesComparisonView =
    val scope = dataset.scope
    val orderedRows = dataset.orderedRows
    val matchCount = dataset.matchCount
    val rowsByPlayer = dataset.rowsByPlayer
    val playerOrder = dataset.playerOrder
    val matchGroups = orderedRows.groupBy(_.matchId).values.toList.sortBy(groupSortKey).zipWithIndex
      .map { case (rows, index) => MatchGroup(index + 1, rows) }
    val matchIndexById = matchGroups.map(group => group.matchId -> group.matchIndex).toMap
    val players = playerOrder.map { memberId =>
      val first = rowsByPlayer(memberId).head
      SeriesComparisonPlayerView(memberId.value, first.memberDisplayName)
    }
    val revenueRanks = rankByMatch(orderedRows, _.revenueManYen.value)
    val assetsRanks = rankByMatch(orderedRows, _.totalAssetsManYen.value)
    val destinationRanks = rankByMatch(orderedRows, _.incidents.destination)
    val assetsHistogram = SeriesComparisonHistogram.forPlayers(
      orderedRows.map(_.totalAssetsManYen.value),
      playerOrder,
      rowsByPlayer,
      row => row.totalAssetsManYen.value,
      HistogramConfig,
    )
    val revenueHistogram = SeriesComparisonHistogram.forPlayers(
      orderedRows.map(_.revenueManYen.value),
      playerOrder,
      rowsByPlayer,
      row => row.revenueManYen.value,
      SeriesComparisonHistogram.revenueBins(HistogramConfig),
    )
    val metrics = playerOrder.map { memberId =>
      val playerRows = rowsByPlayer.getOrElse(memberId, Nil).sortBy(row =>
        (
          row.playedAt.toEpochMilli,
          row.heldEventId.value,
          row.matchNoInEvent.value,
          row.matchId.value,
        )
      )
      memberId.value -> playerMetrics(playerRows, orderedRows, revenueRanks, destinationRanks)
    }.toMap
    val quality =
      dataQuality(playerOrder, rowsByPlayer, orderedRows, revenueRanks, destinationRanks)
    val rankAnalysis = SeriesComparisonRankAnalysisPresenter.analyze(dataset)
    SeriesComparisonView(
      schemaVersion = 10,
      scope = SeriesComparisonScopeView(
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
      ),
      matchCount = matchCount,
      sampleMaturity = sampleMaturity(matchCount),
      rankSpreadSignal = rankSpreadSignal(
        metrics.values.map(_.rank.average),
        matchCount,
      ),
      players = players,
      metricsByPlayer = playerOrder.map(memberId =>
        SeriesComparisonPlayerMetricsEntry(memberId.value, metrics(memberId.value))
      ),
      trends = trends(playerOrder, rowsByPlayer),
      histograms = SeriesComparisonHistogramsView(assetsHistogram, revenueHistogram),
      headToHead = headToHead(playerOrder, orderedRows),
      matchPlayerPoints = matchPlayerPoints(orderedRows, matchIndexById, revenueRanks, assetsRanks),
      recentFormByPlayer = recentFormByPlayer(playerOrder, rowsByPlayer),
      momentumSwitch = momentumSwitchByPlayer(playerOrder, rowsByPlayer),
      playerPerformanceProfiles = playerPerformanceProfiles(playerOrder, rowsByPlayer, metrics),
      assetStyleProfiles = assetStyleProfiles(playerOrder, rowsByPlayer, orderedRows),
      matchNoInEventBreakdown = matchNoInEventBreakdown(playerOrder, orderedRows),
      matchTimeline = matchTimeline(matchGroups),
      cardShopDestination = cardShopDestination(playerOrder, rowsByPlayer),
      playOrderBaselines = playOrderBaselines(orderedRows),
      rankAnalysis = rankAnalysis,
      highlights = highlights(metrics),
      dataQuality = quality,
    )
