import type { components } from "@/shared/api/generated";

export type SeriesComparisonReviewV3 = components["schemas"]["SeriesAnalysisReviewV3Response"];

type Playbook = SeriesComparisonReviewV3["playbookByPlayer"][number];

export type SeriesAnalysisPlaybookCard = NonNullable<Playbook["primaryCard"]>;
export type SeriesAnalysisPlaybookCategory = SeriesAnalysisPlaybookCard["category"];
export type SeriesAnalysisPlaybookClassification = SeriesAnalysisPlaybookCard["classification"];
export type SeriesAnalysisPlaybookEvidenceStrength = SeriesAnalysisPlaybookCard["evidenceStrength"];
