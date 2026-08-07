import { AssetDistributionMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonAssetMetrics";
import { CardShopDestinationMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonCardShopDestinationMetrics";
import {
  GinjiMetrics,
  PlayOrderMetrics,
} from "@/features/seriesComparison/metrics/SeriesComparisonContextMetrics";
import {
  MatchDigestMetrics,
  MatchNoInEventMetrics,
} from "@/features/seriesComparison/metrics/SeriesComparisonFlowDigest";
import {
  MomentumSwitchMetrics,
  RecentFormMetrics,
} from "@/features/seriesComparison/metrics/SeriesComparisonFlowMetrics";
import {
  DestinationOutcomeMetrics,
  RevenueOutcomeMetrics,
} from "@/features/seriesComparison/metrics/SeriesComparisonOutcomeMetrics";
import {
  BasicMetrics,
  HeadToHeadMetrics,
  RateMetrics,
} from "@/features/seriesComparison/metrics/SeriesComparisonOverviewMetrics";
import { buildFocusedMatchMetricContext } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonViewId } from "@/features/seriesComparison/model/seriesComparisonViewModel";
import {
  AnalysisTabs,
  PurposeTabs,
  SectionJumpLinks,
  analysisPanelId,
  analysisTabId,
  analysisViewFor,
  purposePanelId,
  purposeTabId,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import type { AnalysisViewChange } from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { SeriesComparisonFocusedMatch } from "@/features/seriesComparison/page/SeriesComparisonFocusedMatch";
import { ReviewViewContent } from "@/features/seriesComparison/review/SeriesComparisonReviewPanel";
import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";

export type SeriesComparisonContentModel = {
  activeView: SeriesComparisonViewId;
  focusMatchId: string | undefined;
  hasReviewError: boolean;
  onClearFocusedMatch: () => void;
  onRetryReview: () => void;
  onViewChange: AnalysisViewChange;
  response: SeriesComparisonResponse;
  review: SeriesComparisonReviewResponse | undefined;
  reviewLoading: boolean;
};

export function AnalysisViewContent({
  focusMatchId,
  hasReviewError,
  onViewChange,
  onRetryReview,
  response,
  review,
  reviewLoading,
  view,
}: {
  focusMatchId?: string | undefined;
  hasReviewError: boolean;
  onViewChange: AnalysisViewChange;
  onRetryReview: () => void;
  response: SeriesComparisonResponse;
  review: SeriesComparisonReviewResponse | undefined;
  reviewLoading: boolean;
  view: SeriesComparisonViewId;
}) {
  const focusedMatch = buildFocusedMatchMetricContext(response, focusMatchId);
  const focusedIndex = focusedMatch.matchIndex;
  switch (view) {
    case "review":
      return (
        <ReviewViewContent
          hasReviewError={hasReviewError}
          response={response}
          review={review}
          reviewLoading={reviewLoading}
          onRetry={onRetryReview}
          onViewChange={onViewChange}
        />
      );
    case "flow":
      return (
        <>
          <MatchDigestMetrics focusMatchId={focusMatchId} response={response} />
          <RecentFormMetrics focusedMatch={focusedMatch} response={response} />
          <MomentumSwitchMetrics focusedMatch={focusedMatch} response={response} />
          <MatchNoInEventMetrics response={response} />
        </>
      );
    case "drivers":
      return (
        <>
          <AssetDistributionMetrics focusMatchId={focusMatchId} response={response} />
          <RevenueOutcomeMetrics focusedMatch={focusedMatch} response={response} />
          <DestinationOutcomeMetrics response={response} />
        </>
      );
    case "context":
      return (
        <>
          <PlayOrderMetrics response={response} />
          <CardShopDestinationMetrics response={response} />
          <GinjiMetrics focusedIndex={focusedIndex} response={response} />
        </>
      );
  }
  return (
    <>
      <BasicMetrics focusedIndex={focusedIndex} focusedMatch={focusedMatch} response={response} />
      <HeadToHeadMetrics response={response} />
      <RateMetrics focusedIndex={focusedIndex} response={response} />
    </>
  );
}

export function SeriesComparisonContent({ model }: { model: SeriesComparisonContentModel }) {
  const activeDefinition =
    model.activeView === "review" ? undefined : analysisViewFor(model.activeView);
  return (
    <>
      {model.focusMatchId ? (
        <SeriesComparisonFocusedMatch
          focusMatchId={model.focusMatchId}
          response={model.response}
          onClear={model.onClearFocusedMatch}
        />
      ) : null}
      <PurposeTabs activeView={model.activeView} onViewChange={model.onViewChange} />
      {model.activeView === "review" ? (
        <div aria-labelledby={purposeTabId("review")} id={purposePanelId("review")} role="tabpanel">
          <AnalysisViewContent
            focusMatchId={model.focusMatchId}
            hasReviewError={model.hasReviewError}
            response={model.response}
            review={model.review}
            reviewLoading={model.reviewLoading}
            view="review"
            onRetryReview={model.onRetryReview}
            onViewChange={model.onViewChange}
          />
        </div>
      ) : activeDefinition ? (
        <div
          aria-labelledby={purposeTabId("analysis")}
          className="grid gap-4"
          id={purposePanelId("analysis")}
          role="tabpanel"
        >
          <AnalysisTabs activeView={activeDefinition.id} onViewChange={model.onViewChange} />
          <div
            aria-labelledby={analysisTabId(activeDefinition.id)}
            id={analysisPanelId(activeDefinition.id)}
            role="tabpanel"
          >
            <div className="grid gap-4" id={`analysis-${activeDefinition.id}`}>
              <SectionJumpLinks items={activeDefinition.sections} />
              <AnalysisViewContent
                focusMatchId={model.focusMatchId}
                hasReviewError={model.hasReviewError}
                response={model.response}
                review={model.review}
                reviewLoading={model.reviewLoading}
                view={activeDefinition.id}
                onRetryReview={model.onRetryReview}
                onViewChange={model.onViewChange}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
