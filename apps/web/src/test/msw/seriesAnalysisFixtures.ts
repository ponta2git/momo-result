import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisDrilldownV2,
  SeriesAnalysisMatchContextV2,
  SeriesAnalysisOptionsResponse,
  SeriesAnalysisStatusResponse,
  SeriesAnalysisArtifactRef,
  SeriesComparisonAggregateV2,
  SeriesComparisonReviewV2,
} from "@/shared/api/seriesAnalysis";

export const analysisArtifact = {
  algorithmVersion: "rust-v1",
  artifactId: "artifact-current",
  artifactSchemaVersion: 1,
  gameTitleId: "gt_momotetsu_2",
  inputRevision: "12",
  publishedAt: "2026-08-09T01:02:03.000Z",
} as const;

const player = { displayName: "ぽんた", memberId: "member_ponta" } as const;
const scope = { displayName: "総合", kind: "overall", matchCount: 12 } as const;

export function makeSeriesAnalysisOptions(): SeriesAnalysisOptionsResponse {
  return {
    defaultGameTitleId: "gt_momotetsu_2",
    schemaVersion: 1,
    titles: [
      {
        confirmedMatchCount: 12,
        displayName: "桃太郎電鉄2",
        gameTitleId: "gt_momotetsu_2",
        maps: [{ displayName: "東日本編", mapMasterId: "map_east" }],
        seasonMapPairs: [{ mapMasterId: "map_east", seasonMasterId: "season_current" }],
        seasons: [{ displayName: "今シーズン", seasonMasterId: "season_current" }],
      },
    ],
  };
}

export function makeSeriesAnalysisStatus(
  overrides: Partial<SeriesAnalysisStatusResponse> = {},
): SeriesAnalysisStatusResponse {
  return {
    artifactFreshness: "current",
    calculation: {
      finishedAt: analysisArtifact.publishedAt,
      requestedAt: "2026-08-09T01:00:00.000Z",
      startedAt: "2026-08-09T01:00:01.000Z",
      status: "succeeded",
      trigger: "match_mutation",
    },
    currentArtifact: analysisArtifact,
    desired: {
      algorithmVersion: analysisArtifact.algorithmVersion,
      artifactSchemaVersion: 1,
      inputRevision: analysisArtifact.inputRevision,
    },
    gameTitleId: analysisArtifact.gameTitleId,
    schemaVersion: 1,
    ...overrides,
  };
}

const quality = { noTargetCount: 0, okCount: 8, referenceCount: 0 };

export function makeSeriesAnalysisAggregate(
  artifact: SeriesAnalysisArtifactRef = analysisArtifact,
): SeriesComparisonAggregateV2 {
  return {
    artifact,
    assetStyleProfiles: {
      entries: [
        {
          displayName: player.displayName,
          evidence: [
            { kind: "high_asset_rate", tone: "neutral", value: 0.25 },
            { kind: "low_asset_rate", tone: "neutral", value: 0.08 },
            { kind: "win_rate", tone: "neutral", value: 0.5 },
          ],
          memberId: player.memberId,
          metrics: {
            averageRevenueAssetRate: 0.12,
            destinationAverage: 1.5,
            highAssetCount: 3,
            highAssetRate: 0.25,
            lowAssetCount: 1,
            lowAssetRate: 0.08,
            medianAssets: 130_000,
            p10Assets: 50_000,
            p90Assets: 300_000,
            podiumRate: 0.75,
            winRate: 0.5,
          },
          primaryKind: "steady_accumulator",
          qualityStatus: "ok",
          shapeKind: "wide",
          targetCount: 12,
        },
      ],
      highAssetThreshold: 300_000,
      lowAssetThreshold: 50_000,
    },
    cardShopDestination: [
      {
        cardShopMatchCount: 5,
        cardShopRate: 0.42,
        cardShopWithoutDestinationCount: 1,
        denominator: 12,
        displayName: player.displayName,
        memberId: player.memberId,
        quadrants: [
          {
            averageAssets: 180_000,
            averageRank: 1.8,
            averageRevenue: 22_000,
            itemId: "card-shop:member_ponta:destination_with_shop",
            kind: "destination_with_shop",
            podiumRate: 0.8,
            qualityStatus: "ok",
            rate: 0.42,
            targetCount: 5,
            winRate: 0.4,
          },
        ],
      },
    ],
    dataQuality: {
      items: [
        {
          denominator: 12,
          hasTies: false,
          memberId: player.memberId,
          metricId: "rank.average",
          qualityStatus: "ok",
          targetCount: 12,
        },
      ],
      summary: quality,
    },
    headToHead: {
      entries: [
        {
          averageAssetsDiff: null,
          averageRankDiff: null,
          betterRankCount: 0,
          betterRankRate: null,
          itemId: "head-to-head:member_ponta:member_ponta",
          matchCount: 0,
          opponentMemberId: player.memberId,
          qualityStatus: "no_target",
          relativeIntensity: "none",
          signal: "self",
          subjectMemberId: player.memberId,
        },
      ],
    },
    highlights: [
      {
        highlightId: "highlight:rank.average",
        leaderMemberIds: [player.memberId],
        metricId: "rank.average",
        qualityStatus: "ok",
        targetCount: 12,
        value: 1.75,
      },
    ],
    histograms: {
      assets: {
        bins: [{ index: 0, label: "0〜99999", lowerInclusive: 0, upperExclusive: 100_000 }],
        series: [{ counts: [3], memberId: player.memberId }],
      },
      revenue: {
        bins: [{ index: 0, label: "0〜9999", lowerInclusive: 0, upperExclusive: 10_000 }],
        series: [{ counts: [2], memberId: player.memberId }],
      },
    },
    matchDigest: {
      flagCounts: { close_finish: 1 },
      hiddenCount: 4,
      recent: [
        {
          assetGapFirstToLast: 120_000,
          assetGapFirstToSecond: 5_000,
          flags: ["close_finish"],
          heldEventId: "event-12",
          itemId: "match:match-12",
          matchId: "match-12",
          matchIndex: 12,
          matchNoInEvent: 4,
          playedAt: "2026-08-08T12:00:00.000Z",
          qualityStatus: "ok",
          revenueTopMemberIds: [player.memberId],
          totalGinjiCount: 1,
          winnerMemberId: player.memberId,
        },
      ],
      shownCount: 8,
      totalCount: 12,
    },
    matchNoInEvent: {
      entries: [
        {
          category: "regular",
          matchNoInEvent: 1,
          players: [
            {
              averageRank: 1.5,
              displayName: player.displayName,
              memberId: player.memberId,
              podiumRate: 1,
              qualityStatus: "ok",
              targetCount: 3,
            },
          ],
        },
      ],
    },
    metricDefinitions: [
      {
        label: "平均順位",
        metricId: "rank.average",
        preferredDirection: "lower",
        unit: "rank",
      },
    ],
    metricsByPlayer: [
      {
        assets: { average: 150_000, max: 350_000, median: 130_000, min: 20_000 },
        denominator: 12,
        destination: {
          conversionDelta: 0.2,
          dependenceScore: 0.3,
          lowerTargetCount: 5,
          upperTargetCount: 7,
        },
        destinationOutcome: {
          lowDestination: outcome(4, 0.25),
          top: outcome(5, 0.6),
          zeroDestination: outcome(3, 0.2),
        },
        displayName: player.displayName,
        ginji: {
          count: 3,
          encounterMatches: 2,
          encounterRate: 0.17,
          maxInSingleMatch: 2,
          multiEncounterMatchCount: 1,
          resilienceAssetsAverage: 90_000,
          resilienceRankAverage: 2.5,
          resilienceRevenueAverage: 12_000,
        },
        lowerHalf: { count: 3, rate: 0.25 },
        memberId: player.memberId,
        nonRevenue: {
          highRevenueNoWinCount: 2,
          highRevenueNoWinRate: 0.4,
          highRevenueTopCount: 5,
          rankDelta: 0.1,
        },
        playOrder: {
          assetsDiff: 10_000,
          assetsIndex: 1.05,
          breakdown: [
            {
              assetsAverage: 170_000,
              matchCount: 3,
              playOrder: 1,
              qualityStatus: "ok",
              rankAverage: 1.5,
              revenueAverage: 20_000,
            },
          ],
          revenueDiff: 2_000,
          revenueIndex: 1.1,
        },
        podium: { count: 9, rate: 0.75 },
        qualityStatus: "ok",
        rank: { average: 1.75, distribution: rankCells(), standardDeviation: 0.8 },
        revenue: { average: 18_000, max: 45_000, median: 16_000 },
        revenueOutcome: {
          lowRevenue: outcome(4, 0.25),
          nonTopWinCount: 2,
          top: outcome(5, 0.6),
        },
      },
    ],
    momentumSwitch: [
      {
        afterFourth: momentum(2, 0.5, "strength"),
        afterLower: momentum(4, 0.5, "strength"),
        afterPodium: momentum(7, 0.14, "none"),
        cells: [
          {
            count: 1,
            itemId: "momentum:member_ponta:4:1",
            nextRank: 1,
            previousRank: 4,
            qualityStatus: "reference",
            rate: 0.5,
            relativeIntensity: "medium",
            targetCount: 2,
          },
        ],
        denominator: 12,
        displayName: player.displayName,
        memberId: player.memberId,
        transitionCount: 11,
      },
    ],
    performanceProfiles: {
      averageRankScoreMedian: 3.2,
      averageRevenueAssetRateMedian: 0.1,
      entries: [
        {
          averageRankScore: 3.25,
          averageRevenueAssetRate: 0.12,
          displayName: player.displayName,
          memberId: player.memberId,
          profileKind: "steady_leader",
          qualityStatus: "ok",
          rankStandardDeviation: 0.8,
          strategyKind: "property_focused",
        },
      ],
      rankStandardDeviationMedian: 0.9,
    },
    playOrderComparison: [
      {
        bestPlayOrder: 1,
        cells: [
          {
            itemId: "play-order:member_ponta:1",
            playOrder: 1,
            podiumRate: 1,
            qualityStatus: "ok",
            rankAverage: 1.5,
            relativeIntensity: "none",
            targetCount: 3,
          },
        ],
        displayName: player.displayName,
        memberId: player.memberId,
        signal: "visible",
        spread: 0.5,
        worstPlayOrder: 4,
      },
    ],
    players: [player],
    rankAnalysis: {
      crownCertainty: {
        bootstrapIterations: 128,
        leaderChangeCount: 8,
        shares: [{ memberId: player.memberId, share: 0.92 }],
        status: "ok",
        successfulIterations: 128,
      },
      defaultMemberId: player.memberId,
      foldScores: [],
      heldEventCount: 8,
      improvedFoldCount: 5,
      matchCount: 12,
      modelVersion: "rank-bt-v1",
      rankSignalsByPlayer: [
        {
          candidates: [
            {
              candidateSharePercent: 100,
              direction: "more_is_higher",
              importance: 0.12,
              signal: "revenue",
              stabilityBand: "high",
              stable: true,
              supportCount: 5,
            },
          ],
          memberId: player.memberId,
          status: "ok",
        },
      ],
      reasonCodes: [],
      requiredImprovedFoldCount: 4,
      status: "ok",
      unexpectedWinsByPlayer: [
        {
          hasDetails: true,
          latest: {
            actualRank: 1,
            evidence: unexpectedEvidence(),
            expectedRank: 3.1,
            heldEventId: "event-12",
            matchId: "match-12",
            matchNoInEvent: 4,
            playedAt: "2026-08-08T12:00:00.000Z",
          },
          memberId: player.memberId,
          status: "ok",
          totalWinCount: 6,
          unexpectedWinCount: 1,
        },
      ],
    },
    rankDistribution: [
      {
        cells: rankCells().map((cell) =>
          Object.assign({}, cell, {
            itemId: `rank-distribution:${player.memberId}:${cell.rank}`,
          }),
        ),
        displayName: player.displayName,
        memberId: player.memberId,
        qualityStatus: "ok",
        total: 12,
      },
    ],
    recentRanks: [
      {
        averageRank: 1.75,
        displayName: player.displayName,
        lowerHalfStreak: 0,
        memberId: player.memberId,
        podiumRate: 0.75,
        podiumStreak: 2,
        qualityStatus: "ok",
        rows: [
          {
            itemId: "recent-rank:member_ponta:match-12",
            matchId: "match-12",
            playedAt: "2026-08-08T12:00:00.000Z",
            rank: 1,
          },
        ],
        targetCount: 8,
        usedFallback: false,
        windowSize: 8,
        winStreak: 1,
      },
    ],
    revenueRankConversion: [
      {
        cells: [
          {
            count: 4,
            finalRank: 1,
            hasRevenueTie: false,
            itemId: "revenue-rank:member_ponta:1:1",
            rate: 0.8,
            relativeIntensity: "high",
            revenueRank: 1,
          },
        ],
        displayName: player.displayName,
        memberId: player.memberId,
      },
    ],
    schemaVersion: 2,
    scope,
    strategyScatter: {
      points: [
        {
          assetRank: 1,
          itemId: "strategy-point:match-12:member_ponta",
          matchId: "match-12",
          matchIndex: 12,
          memberId: player.memberId,
          playedAt: "2026-08-08T12:00:00.000Z",
          rank: 1,
          revenueAssetRate: 0.12,
          revenueManYen: 25_000,
          revenueRank: 1,
          totalAssetsManYen: 210_000,
        },
      ],
    },
    summary: {
      averageRankSpread: 0.4,
      leaderMemberIds: [player.memberId],
      quality,
      rankSpreadSignal: "visible",
      sampleMaturity: "mature",
      totalGinjiCount: 3,
    },
    trends: [
      {
        kind: "rank_cumulative_average",
        memberId: player.memberId,
        points: [
          {
            index: 12,
            itemId: "trend:rank_cumulative_average:member_ponta:match-12",
            matchId: "match-12",
            playedAt: "2026-08-08T12:00:00.000Z",
            value: 1.75,
          },
        ],
      },
      {
        kind: "rank_cumulative_standard_deviation",
        memberId: player.memberId,
        points: [
          {
            index: 12,
            itemId: "trend:rank_cumulative_standard_deviation:member_ponta:match-12",
            matchId: "match-12",
            playedAt: "2026-08-08T12:00:00.000Z",
            value: 0.8,
          },
        ],
      },
      {
        kind: "podium_cumulative_rate",
        memberId: player.memberId,
        points: [
          {
            index: 12,
            itemId: "trend:podium_cumulative_rate:member_ponta:match-12",
            matchId: "match-12",
            playedAt: "2026-08-08T12:00:00.000Z",
            value: 0.75,
          },
        ],
      },
      {
        kind: "lower_half_cumulative_rate",
        memberId: player.memberId,
        points: [
          {
            index: 12,
            itemId: "trend:lower_half_cumulative_rate:member_ponta:match-12",
            matchId: "match-12",
            playedAt: "2026-08-08T12:00:00.000Z",
            value: 0.25,
          },
        ],
      },
      {
        kind: "ginji_cumulative_count",
        memberId: player.memberId,
        points: [
          {
            index: 12,
            itemId: "trend:ginji_cumulative_count:member_ponta:match-12",
            matchId: "match-12",
            playedAt: "2026-08-08T12:00:00.000Z",
            value: 3,
          },
        ],
      },
    ],
  };
}

export function makeSeriesAnalysisReview(): SeriesComparisonReviewV2 {
  return {
    artifact: analysisArtifact,
    baseline: { matchCount: 12, playerCount: 1, qualityStatus: "ok" },
    commonPlaybookTopics: [],
    dataQuality: { items: [], summary: quality },
    playbookByPlayer: [
      {
        player,
        primaryCard: {
          actionAdviceScore: 0.64,
          actionHypothesis: "収益先行時は目的地0回で終えない。",
          anchorTarget: {
            label: "物件収益と勝ち",
            sectionId: "metric-revenue-outcome",
            view: "drivers",
          },
          avoidAction: "収益だけで安全と見ない。",
          cardId: "playbook:member_ponta:revenue",
          category: "revenue",
          classification: "revise",
          dataReason: "収益上位5戦のうち2戦は勝ち切れていません。",
          evidence: [
            {
              label: "収益上位時の勝率",
              metricId: "revenue.topWinRate",
              qualityStatus: "ok",
              targetCount: 5,
              unit: "rate",
              value: 0.6,
            },
          ],
          evidenceStrength: "low",
          heading: "収益先行時の目的地",
          plainReason: "収益だけでは順位を取り切れない試合があります。",
          postMatchCheck: "収益上位時に目的地到着と入賞を確認する。",
          qualityStatus: "ok",
          recommendedAction: "目的地到着と下位回避を優先する。",
          stabilityBand: "high",
          supportCount: 5,
          targetCount: 5,
          triggerCondition: "収益で上位だが目的地到着がないとき。",
        },
        secondaryCards: [],
      },
    ],
    schemaVersion: 2,
    scope,
  };
}

export function makeSeriesAnalysisDrilldown(metricId: string): SeriesAnalysisDrilldownV2 {
  const common = { artifact: analysisArtifact, player, schemaVersion: 2 as const, scope };
  if (metricId === "playOrder.rankHistory") {
    return {
      ...common,
      payload: {
        kind: "play_order_rank_history",
        rows: [
          {
            lowerHalfRate: 0,
            playOrder: 1,
            podiumRate: 1,
            qualityStatus: "ok",
            rankAverage: 1.5,
            rankDistribution: rankCells(),
            targetCount: 3,
          },
        ],
        seriesByPlayOrder: [
          {
            changeDirection: "improved",
            cumulativeAverageRank: 1.5,
            heldEventId: "event-12",
            itemId: "play-order-history:match-12",
            matchId: "match-12",
            matchIndex: 12,
            matchNoInEvent: 4,
            occurrenceIndex: 3,
            playOrder: 1,
            playedAt: "2026-08-08T12:00:00.000Z",
            previousCumulativeAverageRank: 2,
            rank: 1,
          },
        ],
        summary: { currentAverageRank: 1.75, qualityStatus: "ok", targetCount: 12 },
      },
    };
  }
  if (metricId === "rankAnalysis.rankSignals") {
    return {
      ...common,
      payload: {
        candidates: [
          {
            candidateSharePercent: 100,
            direction: "more_is_higher",
            foldRows: [
              {
                comparisonCount: 24,
                fold: 1,
                heldEventCount: 2,
                importance: 0.12,
                supported: true,
              },
            ],
            importance: 0.12,
            signal: "revenue",
            stabilityBand: "high",
            stable: true,
            supportCount: 5,
          },
        ],
        heldEventCount: 8,
        improvedFoldCount: 5,
        kind: "rank_signals",
        matchCount: 12,
        method: {
          fixedSeed: "1",
          foldCount: 5,
          minimumHeldEvents: 8,
          minimumImportance: 0.0001,
          minimumMatches: 12,
          modelVersion: "rank-bt-v1",
          requiredImprovedFoldCount: 4,
        },
        reasonCodes: [],
        status: "ok",
      },
    };
  }
  if (metricId === "rankAnalysis.unexpectedWins") {
    return {
      ...common,
      payload: {
        kind: "unexpected_wins",
        rows: [
          {
            actualRank: 1,
            evidence: unexpectedEvidence(),
            expectedRank: 3.1,
            heldEventId: "event-12",
            matchId: "match-12",
            matchIndex: 12,
            matchNoInEvent: 4,
            playedAt: "2026-08-08T12:00:00.000Z",
          },
        ],
        summary: {
          heldEventCount: 8,
          matchCount: 12,
          reasonCodes: [],
          status: "ok",
          totalWinCount: 6,
          unexpectedWinCount: 1,
        },
      },
    };
  }
  return {
    ...common,
    payload: {
      eventRows: [
        {
          changeDirection: "improved",
          cumulativeAverageAfter: 1.75,
          cumulativeAverageBefore: 2,
          eventAverageRank: 1.5,
          eventAverageRankDelta: -0.5,
          firstPlayedAt: "2026-08-08T12:00:00.000Z",
          heldEventId: "event-12",
          matchCount: 4,
          ranks: [2, 2, 1, 1],
        },
      ],
      kind: "rank_average_history",
      matchRows: [
        {
          changeDirection: "improved",
          cumulativeAverageRank: 1.75,
          cumulativeAverageRankDelta: -0.05,
          heldEventId: "event-12",
          itemId: "rank-history:match-12",
          matchId: "match-12",
          matchIndex: 12,
          matchNoInEvent: 4,
          playedAt: "2026-08-08T12:00:00.000Z",
          previousRank: 2,
          rank: 1,
          rankDelta: -1,
        },
      ],
      summary: { currentAverageRank: 1.75, qualityStatus: "ok", targetCount: 12 },
    },
  };
}

export function makeSeriesAnalysisMatchContext(): SeriesAnalysisMatchContextV2 {
  return {
    artifact: analysisArtifact,
    inclusion: { sourceMatchRevision: "1", status: "included" },
    match: {
      features: [
        {
          evidence: [],
          featureCode: "close_finish",
          memberIds: [],
          priority: 10,
          source: "match",
          tone: "neutral",
        },
      ],
      focusedItemIds: [
        "rank-distribution:member_ponta:1",
        "play-order:member_ponta:1",
        "recent-rank:member_ponta:match-12",
        "strategy-point:match-12:member_ponta",
        "revenue-rank:member_ponta:1:1",
        "momentum:member_ponta:4:1",
        "card-shop:member_ponta:destination_with_shop",
        "trend:rank_cumulative_average:member_ponta:match-12",
        "trend:rank_cumulative_standard_deviation:member_ponta:match-12",
        "trend:podium_cumulative_rate:member_ponta:match-12",
        "trend:lower_half_cumulative_rate:member_ponta:match-12",
        "trend:ginji_cumulative_count:member_ponta:match-12",
        "match:match-12",
      ],
      matchIndex: 12,
      playedAt: "2026-08-08T12:00:00.000Z",
      players: [
        {
          cumulativeAverageAfter: 1.75,
          cumulativeAverageBefore: 1.82,
          cumulativeAverageDelta: -0.07,
          cumulativeAverageDirection: "improved",
          displayName: player.displayName,
          memberId: player.memberId,
          previousRank: 2,
          rank: 1,
          revenueAssetRate: 0.12,
          revenueManYen: 25_000,
          revenueRank: 1,
          totalAssetsManYen: 210_000,
        },
      ],
    },
    matchId: "match-12",
    schemaVersion: 1,
    scope,
  };
}

export function makeSeriesAnalysisAdminOverview(): SeriesAnalysisAdminOverview {
  return {
    globalExecution: {
      activeCampaignCount: 0,
      latestActiveCampaign: null,
      oldestQueuedAt: null,
      queuedTitleCount: 0,
      runningCount: 0,
    },
    recentJobs: [
      {
        algorithmVersion: "rust-v1",
        attemptCount: 1,
        coalescedTriggers: [],
        elapsedMilliseconds: 1234,
        finishedAt: analysisArtifact.publishedAt,
        firstManualRequester: null,
        gameTitleId: analysisArtifact.gameTitleId,
        gameTitleName: "桃太郎電鉄2",
        inputRevision: "12",
        jobId: "job-1",
        leaseRecoveryCount: 0,
        manualRequestCount: 0,
        queueWaitMilliseconds: 100,
        requestedAt: "2026-08-09T01:00:00.000Z",
        requestedBy: "system",
        resultDisposition: "published",
        safeFailureCode: null,
        startedAt: "2026-08-09T01:00:01.000Z",
        status: "succeeded",
        transientRetryCount: 0,
        trigger: "match_mutation",
      },
    ],
    schemaVersion: 1,
    selectedTitle: {
      gameTitleId: analysisArtifact.gameTitleId,
      gameTitleName: "桃太郎電鉄2",
      pendingManualRun: null,
      status: makeSeriesAnalysisStatus(),
    },
    titleOptions: [
      {
        confirmedMatchCount: 12,
        gameTitleId: analysisArtifact.gameTitleId,
        gameTitleName: "桃太郎電鉄2",
      },
    ],
  };
}

function rankCells() {
  return [1, 2, 3, 4].map((rank) => ({
    count: rank === 1 ? 6 : 2,
    rank,
    rate: rank === 1 ? 0.5 : 1 / 6,
  }));
}

function outcome(targetCount: number, winRate: number) {
  return {
    lowerHalfCount: 1,
    lowerHalfRate: 0.2,
    podiumCount: targetCount - 1,
    podiumRate: 0.8,
    qualityStatus: "ok" as const,
    rankDistribution: rankCells(),
    targetCount,
    winCount: Math.round(targetCount * winRate),
    winRate,
  };
}

function momentum(targetCount: number, rate: number, signal: "none" | "risk" | "strength") {
  return {
    baselineRate: 0.5,
    deltaFromBaseline: rate - 0.5,
    qualityStatus: "ok" as const,
    rate,
    signal,
    successCount: Math.round(targetCount * rate),
    targetCount,
  };
}

function unexpectedEvidence() {
  return {
    cardShopCount: 1,
    cardStationCount: 2,
    destinationCount: 1,
    ginjiCount: 0,
    minusStationCount: 1,
    plusStationCount: 3,
    revenueManYen: 25_000,
  };
}
