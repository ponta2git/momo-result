import { useEffect, useState } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import { SeriesAnalysisDrilldownDialog } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
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
import type { SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";

type SeriesAnalysisContentProps = {
  bundle: SeriesAnalysisDisplayBundle;
  onArtifactExpired: () => void;
  onClearFocusedMatch: () => void;
  onFocusMatch: (matchId: string) => void;
  onViewChange: (view: SeriesAnalysisViewId, options?: { replace?: boolean }) => void;
};

export function SeriesAnalysisContent(props: SeriesAnalysisContentProps) {
  const resource = props.bundle.kind === "review" ? props.bundle.review : props.bundle.aggregate;
  // A drilldown belongs to one artifact/view and must reset before either identity can be mixed.
  const contentIdentity = `${resource.artifact.artifactId}:${props.bundle.view}`;
  return <ArtifactViewContent {...props} key={contentIdentity} />;
}

function ArtifactViewContent({
  bundle,
  onArtifactExpired,
  onClearFocusedMatch,
  onFocusMatch,
  onViewChange,
}: SeriesAnalysisContentProps) {
  const [drilldown, setDrilldown] = useState<SeriesAnalysisDrilldownSelection | null>(null);
  const resource = bundle.kind === "review" ? bundle.review : bundle.aggregate;
  const { matchContext, view: activeView } = bundle;
  const artifactId = resource.artifact.artifactId;

  useEffect(() => {
    const sectionId = decodeURIComponent(window.location.hash.slice(1));
    if (!sectionId) return;
    document.getElementById(sectionId)?.scrollIntoView?.({ block: "start" });
  }, [activeView, artifactId]);

  const baseQuery: SeriesAnalysisQuery = {
    artifactId,
    gameTitleId: resource.artifact.gameTitleId,
    mapMasterId: resource.scope.mapMasterId,
    seasonMasterId: resource.scope.seasonMasterId,
  };
  const focusedItemIds = matchContext?.match?.focusedItemIds ?? [];

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {matchContext ? (
        <SeriesAnalysisSelectedMatch context={matchContext} onClear={onClearFocusedMatch} />
      ) : null}
      <PurposeTabs activeView={activeView} onViewChange={onViewChange} />
      {bundle.kind === "review" ? (
        <ReviewView
          loading={false}
          response={bundle.review}
          showError={false}
          onViewChange={onViewChange}
        />
      ) : (
        <div
          aria-labelledby={purposeTabId("analysis")}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          id={purposePanelId("analysis")}
          role="tabpanel"
        >
          <AnalysisTabs activeView={bundle.view} onViewChange={onViewChange} />
          {bundle.view === "overview" ? (
            <OverviewView
              focusedItemIds={focusedItemIds}
              response={bundle.aggregate}
              onDrilldown={setDrilldown}
            />
          ) : null}
          {bundle.view === "drivers" ? (
            <DriversView
              focusedItemIds={focusedItemIds}
              response={bundle.aggregate}
              onDrilldown={setDrilldown}
            />
          ) : null}
          {bundle.view === "flow" ? (
            <FlowView
              focusedItemIds={focusedItemIds}
              response={bundle.aggregate}
              onDrilldown={setDrilldown}
              onFocusMatch={onFocusMatch}
            />
          ) : null}
          {bundle.view === "context" ? (
            <ContextView
              focusedItemIds={focusedItemIds}
              response={bundle.aggregate}
              onDrilldown={setDrilldown}
            />
          ) : null}
        </div>
      )}
      {bundle.kind === "analysis" ? (
        <>
          <MetricDefinitions response={bundle.aggregate} />
          <SeriesAnalysisDrilldownDialog
            baseQuery={baseQuery}
            selection={drilldown}
            onArtifactExpired={onArtifactExpired}
            onClose={() => setDrilldown(null)}
          />
        </>
      ) : null}
    </div>
  );
}
