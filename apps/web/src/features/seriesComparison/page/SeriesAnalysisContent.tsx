import { useCallback, useEffect, useRef, useState } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import { SeriesAnalysisDrilldownDialog } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { ContextView } from "@/features/seriesComparison/page/SeriesAnalysisContextView";
import { DriversView } from "@/features/seriesComparison/page/SeriesAnalysisDriversView";
import { FlowView } from "@/features/seriesComparison/page/SeriesAnalysisFlowView";
import { SeriesAnalysisMatchContextDialog } from "@/features/seriesComparison/page/SeriesAnalysisMatchContextDialog";
import { OverviewView } from "@/features/seriesComparison/page/SeriesAnalysisOverviewView";
import { ReviewView } from "@/features/seriesComparison/page/SeriesAnalysisReviewView";
import { MetricDefinitions } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisTabs,
  purposePanelId,
  purposeTabId,
  PurposeTabs,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import type {
  SeriesAnalysisQuery,
  SeriesComparisonAggregateV2,
  SeriesComparisonReviewV2,
} from "@/shared/api/seriesAnalysis";

export function SeriesAnalysisContent({
  activeView,
  focusMatchId,
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
  focusMatchId: string | undefined;
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
    onClearFocusedMatch();
  }, [artifactId, onClearFocusedMatch]);

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

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
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
            <OverviewView response={response} onDrilldown={setDrilldown} />
          ) : null}
          {activeView === "drivers" ? (
            <DriversView response={response} onDrilldown={setDrilldown} />
          ) : null}
          {activeView === "flow" ? (
            <FlowView response={response} onDrilldown={setDrilldown} onFocusMatch={onFocusMatch} />
          ) : null}
          {activeView === "context" ? (
            <ContextView response={response} onDrilldown={setDrilldown} />
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
      <SeriesAnalysisMatchContextDialog
        baseQuery={baseQuery}
        matchId={focusMatchId}
        onArtifactExpired={onArtifactExpired}
        onClose={onClearFocusedMatch}
      />
    </div>
  );
}
