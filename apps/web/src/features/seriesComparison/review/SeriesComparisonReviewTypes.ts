import type { SeriesComparisonViewId } from "@/features/seriesComparison/model/seriesComparisonViewModel";
import type { SeriesComparisonReviewResponse } from "@/shared/api/seriesComparison";

export type AnalysisViewChange = (
  view: SeriesComparisonViewId,
  options?: { replace?: boolean },
) => void;
export type ReviewPlayerPlaybook = NonNullable<
  SeriesComparisonReviewResponse["playbookByPlayer"]
>[number];
export type ReviewPlaybookCard = NonNullable<ReviewPlayerPlaybook["cards"]>[number];
export type ReviewPlaybookEvidence = NonNullable<ReviewPlaybookCard["evidence"]>[number];
export type ReviewCommonPlaybookTopic = NonNullable<
  SeriesComparisonReviewResponse["commonPlaybookTopics"]
>[number];
export type ReviewAnchorTarget = ReviewPlaybookCard["anchorTarget"];
