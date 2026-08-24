import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysisAggregateTypes";
import type {
  DataQualityStatus,
  SeriesAnalysisArtifactRef,
  SeriesAnalysisPlayer,
  SeriesAnalysisScope,
} from "@/shared/api/seriesAnalysisCoreTypes";
import type { SeriesAnalysisReviewEvidence } from "@/shared/api/seriesAnalysisMetricTypes";

export type SeriesAnalysisPlaybookCategory =
  | "accident"
  | "assets"
  | "destination"
  | "destinationPositive"
  | "ginji"
  | "playOrder"
  | "recovery"
  | "revenue";

export type SeriesAnalysisPlaybookClassification = "reproduce" | "revise" | "verify";

export type SeriesAnalysisPlaybookEvidenceStrength = "high" | "low" | "medium";

export type SeriesAnalysisPlaybookAnchorView = "context" | "drivers" | "flow";

export type SeriesAnalysisPlaybookCard = {
  actionAdviceScore: number;
  actionHypothesis: string;
  anchorTarget: { label: string; sectionId: string; view: SeriesAnalysisPlaybookAnchorView };
  avoidAction: string;
  cardId: string;
  category: SeriesAnalysisPlaybookCategory;
  classification: SeriesAnalysisPlaybookClassification;
  dataReason: string;
  evidence: SeriesAnalysisReviewEvidence[];
  evidenceStrength: SeriesAnalysisPlaybookEvidenceStrength;
  heading: string;
  plainReason: string;
  postMatchCheck: string;
  qualityStatus: DataQualityStatus;
  recommendedAction: string;
  stabilityBand?: "high" | "low" | "medium" | undefined;
  supportCount?: number | undefined;
  targetCount: number;
  triggerCondition: string;
};

export type SeriesComparisonReviewV3 = {
  artifact: SeriesAnalysisArtifactRef;
  baseline: {
    matchCount: number;
    playerCount: number;
    qualityStatus: DataQualityStatus;
  };
  commonPlaybookTopics: Array<{
    category: SeriesAnalysisPlaybookCategory;
    detail: string;
    heading: string;
    playerIds: string[];
    topicId: string;
  }>;
  dataQuality: SeriesComparisonAggregateV3["dataQuality"];
  playbookByPlayer: Array<{
    player: SeriesAnalysisPlayer;
    primaryCard: SeriesAnalysisPlaybookCard | null;
    secondaryCards: SeriesAnalysisPlaybookCard[];
  }>;
  schemaVersion: 3;
  scope: SeriesAnalysisScope;
};
