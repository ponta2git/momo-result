import type {
  ChangeDirection,
  DataQualityStatus,
  RankCell,
  SeriesAnalysisArtifactRef,
  SeriesAnalysisPlayer,
  SeriesAnalysisScope,
} from "@/shared/api/seriesAnalysisCoreTypes";
import type {
  SeriesAnalysisRankCandidate,
  SeriesAnalysisReviewEvidence,
  SeriesAnalysisUnexpectedWinEvidence,
} from "@/shared/api/seriesAnalysisMetricTypes";
import type { MatchFeatureId } from "@/shared/domain/matchFeatures";

export type SeriesAnalysisQuery = {
  artifactId: string;
  gameTitleId: string;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
};

export type SeriesAnalysisDrilldownMetricId =
  | "playOrder.rankHistory"
  | "rank.averageHistory"
  | "rankAnalysis.rankSignals"
  | "rankAnalysis.unexpectedWins";

export type SeriesAnalysisDrilldownQuery = SeriesAnalysisQuery & {
  memberId: string;
  metricId: SeriesAnalysisDrilldownMetricId;
};

export type SeriesAnalysisDrilldownV2 = {
  artifact: SeriesAnalysisArtifactRef;
  payload:
    | {
        eventRows: Array<{
          changeDirection: ChangeDirection;
          cumulativeAverageAfter: number;
          cumulativeAverageBefore: number | null;
          eventAverageRank: number;
          eventAverageRankDelta: number | null;
          firstPlayedAt: string;
          heldEventId: string;
          matchCount: number;
          ranks: number[];
        }>;
        kind: "rank_average_history";
        matchRows: Array<{
          changeDirection: ChangeDirection;
          cumulativeAverageRank: number;
          cumulativeAverageRankDelta: number | null;
          heldEventId: string;
          itemId: string;
          matchId: string;
          matchIndex: number;
          matchNoInEvent: number;
          playedAt: string;
          previousRank: number | null;
          rank: number;
          rankDelta: number | null;
        }>;
        summary: {
          currentAverageRank: number | null;
          qualityStatus: DataQualityStatus;
          targetCount: number;
        };
      }
    | {
        kind: "play_order_rank_history";
        rows: Array<{
          lowerHalfRate: number | null;
          playOrder: number;
          podiumRate: number | null;
          qualityStatus: DataQualityStatus;
          rankAverage: number | null;
          rankDistribution: RankCell[];
          targetCount: number;
        }>;
        seriesByPlayOrder: Array<{
          changeDirection: ChangeDirection;
          cumulativeAverageRank: number;
          heldEventId: string;
          itemId: string;
          matchId: string;
          matchIndex: number;
          matchNoInEvent: number;
          occurrenceIndex: number;
          playOrder: number;
          playedAt: string;
          previousCumulativeAverageRank: number | null;
          rank: number;
        }>;
        summary: {
          currentAverageRank: number | null;
          qualityStatus: DataQualityStatus;
          targetCount: number;
        };
      }
    | {
        candidates: Array<
          SeriesAnalysisRankCandidate & {
            foldRows: Array<{
              comparisonCount: number;
              fold: number;
              heldEventCount: number;
              importance: number;
              supported: boolean;
            }>;
          }
        >;
        heldEventCount: number;
        improvedFoldCount: number;
        kind: "rank_signals";
        matchCount: number;
        method: {
          fixedSeed: string;
          foldCount: number;
          minimumHeldEvents: number;
          minimumImportance: number;
          minimumMatches: number;
          modelVersion: string;
          requiredImprovedFoldCount: number;
        };
        reasonCodes: string[];
        status: DataQualityStatus;
      }
    | {
        kind: "unexpected_wins";
        rows: Array<{
          actualRank: number;
          evidence: SeriesAnalysisUnexpectedWinEvidence;
          expectedRank: number;
          heldEventId: string;
          matchId: string;
          matchIndex: number;
          matchNoInEvent: number;
          playedAt: string;
        }>;
        summary: {
          heldEventCount: number;
          matchCount: number;
          reasonCodes: string[];
          status: DataQualityStatus;
          totalWinCount: number;
          unexpectedWinCount: number;
        };
      };
  player: SeriesAnalysisPlayer;
  schemaVersion: 2;
  scope: SeriesAnalysisScope;
};

export type SeriesAnalysisMatchContextQuery = SeriesAnalysisQuery & { matchId: string };

export type SeriesAnalysisMatchContextV2 = {
  artifact: SeriesAnalysisArtifactRef;
  inclusion:
    | { sourceMatchRevision: string; status: "included" }
    | { status: "match_changed_since_artifact" | "not_in_artifact" | "not_in_scope" };
  match: null | {
    features: Array<{
      evidence: SeriesAnalysisReviewEvidence[];
      featureCode: MatchFeatureId;
      memberIds: string[];
      priority: number;
      source: "match" | "series";
      tone: "neutral" | "notice";
    }>;
    focusedItemIds: string[];
    matchIndex: number;
    playedAt: string;
    players: Array<{
      cumulativeAverageAfter: number;
      cumulativeAverageBefore: number | null;
      cumulativeAverageDelta: number | null;
      cumulativeAverageDirection: ChangeDirection;
      displayName: string;
      memberId: string;
      previousRank: number | null;
      rank: number;
      revenueAssetRate: number | null;
      revenueManYen: number;
      revenueRank: number;
      totalAssetsManYen: number;
    }>;
  };
  matchId: string;
  schemaVersion: 1;
  scope: SeriesAnalysisScope;
};
