import type {
  DataQualityStatus,
  RankCell,
  RelativeIntensity,
  SeriesAnalysisArtifactRef,
  SeriesAnalysisPlayer,
  SeriesAnalysisPlayerMetrics,
  SeriesAnalysisScope,
} from "@/shared/api/seriesAnalysisCoreTypes";
import type {
  SeriesAnalysisHistogram,
  SeriesAnalysisMatchDigestRow,
  SeriesAnalysisMomentumRate,
  SeriesAnalysisRankAnalysis,
} from "@/shared/api/seriesAnalysisMetricTypes";

export type SeriesComparisonAggregateV3 = {
  artifact: SeriesAnalysisArtifactRef;
  assetStyleProfiles: {
    entries: Array<{
      displayName: string;
      evidence: Array<{
        kind: string;
        tone: "neutral" | "risk" | "strength";
        value: number | null;
      }>;
      memberId: string;
      metrics: {
        averageRevenueAssetRate: number | null;
        blowoutWinCount: number;
        destinationAverage: number | null;
        destinationPositiveRate: number | null;
        heavyLossCount: number;
        highAssetCount: number;
        highAssetRate: number | null;
        lowerHalfMedianGap: number | null;
        lowerHalfRate: number | null;
        lowAssetCount: number;
        lowAssetRate: number | null;
        medianAssets: number | null;
        nearMissSecondCount: number;
        p10Assets: number | null;
        p90P10Spread: number | null;
        p90Assets: number | null;
        podiumRate: number | null;
        secondCount: number;
        secondMedianGap: number | null;
        secondRate: number | null;
        winCount: number;
        winMedianAssets: number | null;
        winMedianMargin: number | null;
        winRate: number | null;
      };
      primaryKind: string | null;
      qualityStatus: DataQualityStatus;
      secondaryKind: string | null;
      shapeKind: string | null;
      tags: string[];
      targetCount: number;
    }>;
    blowoutWinThreshold: number | null;
    heavyLossThreshold: number | null;
    highAssetThreshold: number | null;
    lowAssetThreshold: number | null;
    nearMissSecondThreshold: number | null;
  };
  cardShopDestination: Array<{
    cardShopMatchCount: number;
    cardShopRate: number | null;
    cardShopWithoutDestinationCount: number;
    cardShopWithoutDestinationRate: number | null;
    denominator: number;
    displayName: string;
    memberId: string;
    quadrants: Array<{
      averageAssets: number | null;
      averageRank: number | null;
      averageRevenue: number | null;
      itemId: string;
      kind: string;
      podiumRate: number | null;
      qualityStatus: DataQualityStatus;
      rate: number | null;
      targetCount: number;
      winRate: number | null;
    }>;
  }>;
  dataQuality: {
    items: Array<{
      denominator: number;
      hasTies: boolean;
      memberId: string;
      metricId: string;
      qualityStatus: DataQualityStatus;
      targetCount: number;
    }>;
    summary: { noTargetCount: number; okCount: number; referenceCount: number };
  };
  headToHead: {
    entries: Array<{
      averageAssetsDiff: number | null;
      averageRankDiff: number | null;
      betterRankCount: number;
      betterRankRate: number | null;
      itemId: string;
      matchCount: number;
      opponentMemberId: string;
      qualityStatus: DataQualityStatus;
      relativeIntensity: RelativeIntensity;
      sampleMaturity?: "early" | "mature" | undefined;
      signal: string;
      subjectMemberId: string;
    }>;
  };
  highlights: Array<{
    highlightId: string;
    leaderMemberIds: string[];
    metricId: string;
    qualityStatus: DataQualityStatus;
    targetCount: number;
    value: number;
  }>;
  histograms: {
    assets: SeriesAnalysisHistogram;
    revenue: SeriesAnalysisHistogram;
  };
  matchDigest: {
    flagCounts: Record<string, number>;
    hiddenCount: number;
    recent: SeriesAnalysisMatchDigestRow[];
    shownCount: number;
    totalCount: number;
  };
  matchNoInEvent: {
    entries: Array<{
      category: "additional" | "regular";
      matchNoInEvent: number;
      players: Array<{
        averageRank: number | null;
        displayName: string;
        memberId: string;
        podiumRate: number | null;
        qualityStatus: DataQualityStatus;
        targetCount: number;
      }>;
    }>;
  };
  metricDefinitions: Array<{
    label: string;
    metricId: string;
    preferredDirection: "contextual" | "higher" | "lower";
    unit: string;
  }>;
  metricsByPlayer: SeriesAnalysisPlayerMetrics[];
  momentumSwitch: Array<{
    afterFourth: SeriesAnalysisMomentumRate;
    afterLower: SeriesAnalysisMomentumRate;
    afterPodium: SeriesAnalysisMomentumRate;
    cells: Array<{
      count: number;
      itemId: string;
      nextRank: number;
      previousRank: number;
      qualityStatus: DataQualityStatus;
      rate: number | null;
      relativeIntensity: RelativeIntensity;
      targetCount: number;
    }>;
    denominator: number;
    displayName: string;
    memberId: string;
    transitionCount: number;
  }>;
  performanceProfiles: {
    averageRankScoreMedian: number | null;
    averageRevenueAssetRateMedian: number | null;
    entries: Array<{
      averageRankScore: number | null;
      averageRevenueAssetRate: number | null;
      displayName: string;
      memberId: string;
      profileKind: string | null;
      qualityStatus: DataQualityStatus;
      rankStandardDeviation: number | null;
      strategyKind: string | null;
    }>;
    rankStandardDeviationMedian: number | null;
  };
  playOrderComparison: Array<{
    bestPlayOrder: number | null;
    cells: Array<{
      itemId: string;
      playOrder: number;
      podiumRate: number | null;
      qualityStatus: DataQualityStatus;
      rankAverage: number | null;
      relativeIntensity: RelativeIntensity;
      targetCount: number;
    }>;
    displayName: string;
    memberId: string;
    signal: string;
    spread: number | null;
    worstPlayOrder: number | null;
  }>;
  players: SeriesAnalysisPlayer[];
  rankAnalysis: SeriesAnalysisRankAnalysis;
  rankDistribution: Array<{
    cells: Array<RankCell & { itemId: string }>;
    displayName: string;
    memberId: string;
    qualityStatus: DataQualityStatus;
    total: number;
  }>;
  recentRanks: Array<{
    averageRank: number | null;
    displayName: string;
    lowerHalfStreak: number;
    memberId: string;
    podiumRate: number | null;
    podiumStreak: number;
    qualityStatus: DataQualityStatus;
    rows: Array<{ itemId: string; matchId: string; playedAt: string; rank: number }>;
    targetCount: number;
    usedFallback: boolean;
    windowSize: number;
    winStreak: number;
  }>;
  revenueRankConversion: Array<{
    cells: Array<{
      count: number;
      finalRank: number;
      hasRevenueTie: boolean;
      itemId: string;
      rate: number | null;
      relativeIntensity: RelativeIntensity;
      revenueRank: number;
    }>;
    displayName: string;
    memberId: string;
  }>;
  schemaVersion: 3;
  scope: SeriesAnalysisScope;
  source: { gameTitleId: string };
  strategyScatter: {
    points: Array<{
      assetRank: number | null;
      itemId: string;
      matchId: string;
      matchIndex: number;
      memberId: string;
      playedAt: string;
      rank: number;
      revenueAssetRate: number | null;
      revenueManYen: number;
      revenueRank: number | null;
      totalAssetsManYen: number;
    }>;
  };
  summary: {
    averageRankSpread: number | null;
    leaderMemberIds: string[];
    quality: { noTargetCount: number; okCount: number; referenceCount: number };
    rankSpreadSignal: string;
    totalGinjiCount: number;
  };
  trends: Array<{
    kind: string;
    memberId: string;
    points: Array<{
      index: number;
      itemId: string;
      matchId: string;
      playedAt: string;
      value: number;
    }>;
  }>;
};
