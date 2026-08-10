import { useCallback, useEffect, useRef, useState } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import { SeriesAnalysisDrilldownDialog } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { ContextView } from "@/features/seriesComparison/page/SeriesAnalysisContextView";
import { DriversView } from "@/features/seriesComparison/page/SeriesAnalysisDriversView";
import { FlowView } from "@/features/seriesComparison/page/SeriesAnalysisFlowView";
import { OverviewView } from "@/features/seriesComparison/page/SeriesAnalysisOverviewView";
import { ReviewView } from "@/features/seriesComparison/page/SeriesAnalysisReviewView";
import { SeriesAnalysisSelectedMatch } from "@/features/seriesComparison/page/SeriesAnalysisSelectedMatch";
import { MetricDefinitions } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisTabs,
  purposePanelId,
  purposeTabId,
  PurposeTabs,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import type {
  SeriesAnalysisQuery,
  SeriesAnalysisMatchContextV2,
  SeriesComparisonAggregateV2,
  SeriesComparisonReviewV2,
} from "@/shared/api/seriesAnalysis";

export function SeriesAnalysisContent({
  activeView,
  matchContext,
  onArtifactExpired,
  onClearFocusedMatch,
  onFocusMatch,
  onViewChange,
  response,
  review,
  reviewError,
  reviewLoading,
}: {
  activeView: SeriesAnalysisViewId;
  matchContext: SeriesAnalysisMatchContextV2 | undefined;
  onArtifactExpired: () => void;
  onClearFocusedMatch: () => void;
  onFocusMatch: (matchId: string) => void;
  onViewChange: (view: SeriesAnalysisViewId, options?: { replace?: boolean }) => void;
  response: SeriesComparisonAggregateV2;
  review: SeriesComparisonReviewV2 | undefined;
  reviewError: boolean;
  reviewLoading: boolean;
}) {
  const [drilldown, setDrilldown] = useState<SeriesAnalysisDrilldownSelection | null>(null);
  const artifactId = response.artifact.artifactId;
  const previousArtifactId = useRef(artifactId);
  useEffect(() => {
    if (previousArtifactId.current === artifactId) return;
    previousArtifactId.current = artifactId;
    setDrilldown(null);
  }, [artifactId]);

  useEffect(() => {
    const sectionId = decodeURIComponent(window.location.hash.slice(1));
    if (!sectionId) return;
    document.getElementById(sectionId)?.scrollIntoView?.({ block: "start" });
  }, [activeView, artifactId]);

  const baseQuery: SeriesAnalysisQuery = {
    artifactId,
    gameTitleId: response.artifact.gameTitleId,
    mapMasterId: response.scope.mapMasterId,
    seasonMasterId: response.scope.seasonMasterId,
  };
  const changeView = useCallback(
    (view: Parameters<typeof onViewChange>[0]) => onViewChange(view),
    [onViewChange],
  );
  const focusedItemIds = matchContext?.match?.focusedItemIds ?? [];

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {matchContext ? (
        <SeriesAnalysisSelectedMatch context={matchContext} onClear={onClearFocusedMatch} />
      ) : null}
      <PurposeTabs activeView={activeView} onViewChange={changeView} />
      {activeView === "review" ? (
        <ReviewView
          loading={reviewLoading}
          response={review}
          showError={reviewError}
          onViewChange={onViewChange}
        />
      ) : (
        <div
          aria-labelledby={purposeTabId("analysis")}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          id={purposePanelId("analysis")}
          role="tabpanel"
        >
          <AnalysisTabs activeView={activeView} onViewChange={changeView} />
          {activeView === "overview" ? (
            <OverviewView
              focusedItemIds={focusedItemIds}
              response={response}
              onDrilldown={setDrilldown}
            />
          ) : null}
          {activeView === "drivers" ? (
            <DriversView
              focusedItemIds={focusedItemIds}
              response={response}
              onDrilldown={setDrilldown}
            />
          ) : null}
          {activeView === "flow" ? (
            <FlowView
              focusedItemIds={focusedItemIds}
              response={response}
              onDrilldown={setDrilldown}
              onFocusMatch={onFocusMatch}
            />
          ) : null}
          {activeView === "context" ? (
            <ContextView
              focusedItemIds={focusedItemIds}
              response={response}
              onDrilldown={setDrilldown}
            />
          ) : null}
        </div>
      )}
      <MetricDefinitions response={response} />
      <SeriesAnalysisDrilldownDialog
        baseQuery={baseQuery}
        selection={drilldown}
        onArtifactExpired={onArtifactExpired}
        onClose={() => setDrilldown(null)}
      />
    </div>
  );
}
