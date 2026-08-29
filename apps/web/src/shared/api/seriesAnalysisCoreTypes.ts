import type { components } from "@/shared/api/generated";

export type DataQualityStatus = "no_target" | "ok" | "reference";
export type RelativeIntensity = "high" | "low" | "medium" | "none";
export type ChangeDirection = "declined" | "first_observation" | "improved" | "unchanged";

export type SeriesAnalysisArtifactRef = {
  algorithmVersion: string;
  artifactId: string;
  artifactSchemaVersion: number;
  gameTitleId: string;
  inputRevision: string;
  publishedAt: string;
};

export type SeriesAnalysisScope = {
  displayName: string;
  kind: "map" | "overall" | "season" | "season_map";
  mapMasterId?: string | undefined;
  matchCount: number;
  seasonMasterId?: string | undefined;
};

export type SeriesAnalysisPlayer = {
  displayName: string;
  memberId: string;
};

export type SeriesAnalysisOptionsResponse = components["schemas"]["SeriesAnalysisOptionsResponse"];

export type SeriesAnalysisStatusResponse = components["schemas"]["SeriesAnalysisStatusResponse"];

export type RankCell = { count: number; rank: number; rate: number | null };

type ConditionalOutcome = {
  lowerHalfCount: number;
  lowerHalfRate: number | null;
  podiumCount: number;
  podiumRate: number | null;
  qualityStatus: DataQualityStatus;
  rankDistribution: RankCell[];
  targetCount: number;
  winCount: number;
  winRate: number | null;
};

export type SeriesAnalysisPlayerMetrics = {
  assets: { average: number | null; max: number | null; median: number | null; min: number | null };
  denominator: number;
  destination: {
    conversionDelta: number | null;
    dependenceScore: number | null;
    lowerTargetCount: number;
    upperTargetCount: number;
  };
  destinationOutcome: {
    lowDestination: ConditionalOutcome;
    top: ConditionalOutcome;
    zeroDestination: ConditionalOutcome;
  };
  displayName: string;
  ginji: {
    count: number;
    encounterMatches: number;
    encounterRate: number | null;
    maxInSingleMatch: number;
    multiEncounterMatchCount: number;
    resilienceAssetsAverage: number | null;
    resilienceRankAverage: number | null;
    resilienceRevenueAverage: number | null;
  };
  lowerHalf: { count: number; rate: number | null };
  memberId: string;
  nonRevenue: {
    highRevenueNoWinCount: number;
    highRevenueNoWinRate: number | null;
    highRevenueTopCount: number;
    rankDelta: number | null;
  };
  playOrder: {
    assetsDiff: number | null;
    assetsIndex: number | null;
    breakdown: Array<{
      assetsAverage: number | null;
      matchCount: number;
      playOrder: number;
      qualityStatus: DataQualityStatus;
      rankAverage: number | null;
      revenueAverage: number | null;
    }>;
    revenueDiff: number | null;
    revenueIndex: number | null;
  };
  podium: { count: number; rate: number | null };
  qualityStatus: DataQualityStatus;
  rank: { average: number | null; distribution: RankCell[]; standardDeviation: number | null };
  revenue: { average: number | null; max: number | null; median: number | null };
  revenueOutcome: {
    lowRevenue: ConditionalOutcome;
    nonTopWinCount: number;
    top: ConditionalOutcome;
  };
};
