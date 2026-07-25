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
import { ReviewViewContent } from "@/features/seriesComparison/review/SeriesComparisonReviewPanel";
import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";

export type SeriesComparisonContentModel = {
  activeView: SeriesComparisonViewId;
  hasReviewError: boolean;
  onViewChange: AnalysisViewChange;
  response: SeriesComparisonResponse;
  review: SeriesComparisonReviewResponse | undefined;
  reviewLoading: boolean;
};

export function AnalysisViewContent({
  hasReviewError,
  onViewChange,
  response,
  review,
  reviewLoading,
  view,
}: {
  hasReviewError: boolean;
  onViewChange: AnalysisViewChange;
  response: SeriesComparisonResponse;
  review: SeriesComparisonReviewResponse | undefined;
  reviewLoading: boolean;
  view: SeriesComparisonViewId;
}) {
  switch (view) {
    case "review":
      return (
        <ReviewViewContent
          hasReviewError={hasReviewError}
          response={response}
          review={review}
          reviewLoading={reviewLoading}
          onViewChange={onViewChange}
        />
      );
    case "flow":
      return (
        <>
          <MatchDigestMetrics response={response} />
          <RecentFormMetrics response={response} />
          <MomentumSwitchMetrics response={response} />
          <MatchNoInEventMetrics response={response} />
        </>
      );
    case "drivers":
      return (
        <>
          <AssetDistributionMetrics response={response} />
          <RevenueOutcomeMetrics response={response} />
          <DestinationOutcomeMetrics response={response} />
        </>
      );
    case "context":
      return (
        <>
          <PlayOrderMetrics response={response} />
          <CardShopDestinationMetrics response={response} />
          <GinjiMetrics response={response} />
        </>
      );
  }
  return (
    <>
      <BasicMetrics response={response} />
      <HeadToHeadMetrics response={response} />
      <RateMetrics response={response} />
    </>
  );
}

export function SeriesComparisonContent({ model }: { model: SeriesComparisonContentModel }) {
  const activeDefinition =
    model.activeView === "review" ? undefined : analysisViewFor(model.activeView);
  return (
    <>
      <PurposeTabs activeView={model.activeView} onViewChange={model.onViewChange} />
      {model.activeView === "review" ? (
        <div aria-labelledby={purposeTabId("review")} id={purposePanelId("review")} role="tabpanel">
          <AnalysisViewContent
            hasReviewError={model.hasReviewError}
            response={model.response}
            review={model.review}
            reviewLoading={model.reviewLoading}
            view="review"
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
                hasReviewError={model.hasReviewError}
                response={model.response}
                review={model.review}
                reviewLoading={model.reviewLoading}
                view={activeDefinition.id}
                onViewChange={model.onViewChange}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
