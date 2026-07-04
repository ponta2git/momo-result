import { AssetDistributionMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonAssetMetrics";
import { CardShopDestinationMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonCardShopDestinationMetrics";
import {
  GinjiMetrics,
  PlayOrderMetrics,
} from "@/features/seriesComparison/metrics/SeriesComparisonContextMetrics";
import {
  DataQualityNotice,
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
import { defaultSeriesComparisonView } from "@/features/seriesComparison/model/seriesComparisonViewModel";
import type { SeriesComparisonViewId } from "@/features/seriesComparison/model/seriesComparisonViewModel";
import {
  AnalysisTabs,
  SectionJumpLinks,
  analysisPanelId,
  analysisTabId,
  analysisViewFor,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import type { AnalysisViewChange } from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { SummaryBand } from "@/features/seriesComparison/page/SeriesComparisonSummary";
import type { useSeriesComparisonPageController } from "@/features/seriesComparison/page/useSeriesComparisonPageController";
import { ReviewViewContent } from "@/features/seriesComparison/review/SeriesComparisonReviewPanel";
import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";

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

export function SeriesComparisonContent({
  controller,
}: {
  controller: ReturnType<typeof useSeriesComparisonPageController>;
}) {
  if (!controller.aggregate) {
    return null;
  }
  const activeView = controller.state.view ?? defaultSeriesComparisonView;
  const activeDefinition = analysisViewFor(activeView);
  return (
    <>
      <div className="text-sm text-[var(--color-text-secondary)]">
        {controller.selectedSeries?.name}・{controller.scopeName}
      </div>
      <SummaryBand response={controller.aggregate} />
      <AnalysisTabs activeView={activeView} onViewChange={controller.updateView} />
      <DataQualityNotice response={controller.aggregate} />
      <div
        aria-labelledby={analysisTabId(activeDefinition.id)}
        id={analysisPanelId(activeDefinition.id)}
        role="tabpanel"
      >
        <div className="grid gap-4" id={`analysis-${activeDefinition.id}`}>
          <SectionJumpLinks items={activeDefinition.sections} />
          <AnalysisViewContent
            hasReviewError={controller.hasReviewError}
            response={controller.aggregate}
            review={controller.reviewShielded ? undefined : controller.review}
            reviewLoading={controller.reviewLoading || controller.reviewShielded}
            view={activeDefinition.id}
            onViewChange={controller.updateView}
          />
        </div>
      </div>
    </>
  );
}
