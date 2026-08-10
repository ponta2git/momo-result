import type { DataQualityStatus } from "@/shared/api/seriesAnalysisCoreTypes";

export type SeriesAnalysisHistogram = {
  bins: Array<{
    index: number;
    label: string;
    lowerInclusive: number;
    upperExclusive: number | null;
  }>;
  series: Array<{ counts: number[]; memberId: string }>;
};

export type SeriesAnalysisMomentumRate = {
  baselineRate: number | null;
  deltaFromBaseline: number | null;
  qualityStatus: DataQualityStatus;
  rate: number | null;
  signal: "none" | "risk" | "strength";
  successCount: number;
  targetCount: number;
};

export type SeriesAnalysisMatchDigestRow = {
  assetGapFirstToLast: number | null;
  assetGapFirstToSecond: number | null;
  flags: string[];
  heldEventId: string;
  itemId: string;
  matchId: string;
  matchIndex: number;
  matchNoInEvent: number;
  playedAt: string;
  qualityStatus: DataQualityStatus;
  revenueTopMemberIds: string[];
  totalGinjiCount: number;
  winnerMemberId: string | null;
};

export type SeriesAnalysisRankCandidate = {
  candidateSharePercent: number | null;
  direction: string;
  importance: number;
  signal: string;
  stabilityBand: "high" | "low" | "medium";
  stable: boolean;
  supportCount: number;
};

export type SeriesAnalysisRankAnalysis = {
  crownCertainty: {
    bootstrapIterations: number;
    leaderChangeCount: number;
    shares: Array<{ memberId: string; share: number }>;
    status: DataQualityStatus;
    successfulIterations: number;
  };
  defaultMemberId: string | null;
  foldScores: Array<{
    baselineBrierScore: number;
    baselineLogLoss: number;
    comparisonCount: number;
    fold: number;
    fullBrierScore: number;
    fullLogLoss: number;
    fullModelImproved: boolean;
    heldEventCount: number;
  }>;
  heldEventCount: number;
  improvedFoldCount: number;
  matchCount: number;
  modelVersion: string;
  rankSignalsByPlayer: Array<{
    candidates: SeriesAnalysisRankCandidate[];
    memberId: string;
    status: DataQualityStatus;
  }>;
  reasonCodes: string[];
  requiredImprovedFoldCount: number;
  status: DataQualityStatus;
  unexpectedWinsByPlayer: Array<{
    hasDetails: boolean;
    latest: null | {
      actualRank: number;
      evidence: SeriesAnalysisUnexpectedWinEvidence;
      expectedRank: number;
      heldEventId: string;
      matchId: string;
      matchNoInEvent: number;
      playedAt: string;
    };
    memberId: string;
    status: DataQualityStatus;
    totalWinCount: number;
    unexpectedWinCount: number;
  }>;
};

export type SeriesAnalysisUnexpectedWinEvidence = {
  cardShopCount: number;
  cardStationCount: number;
  destinationCount: number;
  ginjiCount: number;
  minusStationCount: number;
  plusStationCount: number;
  revenueManYen: number;
};

export type SeriesAnalysisReviewEvidence = {
  denominator?: number | null | undefined;
  effectEstimate?: number | null | undefined;
  label?: string | undefined;
  metricId: string;
  qualityStatus?: DataQualityStatus | undefined;
  stabilityBand?: "high" | "low" | "medium" | undefined;
  status?: DataQualityStatus | "hidden" | undefined;
  supportCount?: number | undefined;
  targetCount?: number | undefined;
  unit?: string | undefined;
  value: number | null | string;
};
