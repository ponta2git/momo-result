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

type SeriesAnalysisBundle = Extract<SeriesAnalysisDisplayBundle, { kind: "analysis" }>;

export function SeriesAnalysisContent(props: SeriesAnalysisContentProps) {
  return <ArtifactViewContent {...props} />;
}

function ArtifactViewContent({
  bundle,
  onArtifactExpired,
  onClearFocusedMatch,
  onFocusMatch,
  onViewChange,
}: SeriesAnalysisContentProps) {
  const resource = bundle.kind === "review" ? bundle.review : bundle.aggregate;
  const { matchContext, view: activeView } = bundle;
  const artifactId = resource.artifact.artifactId;
  const contentIdentity = `${artifactId}:${activeView}`;

  useEffect(() => {
    const sectionId = decodeURIComponent(window.location.hash.slice(1));
    if (!sectionId) return;
    document.getElementById(sectionId)?.scrollIntoView?.({ block: "start" });
  }, [activeView, artifactId]);

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
          <AnalysisViewContent
            bundle={bundle}
            key={contentIdentity}
            onArtifactExpired={onArtifactExpired}
            onFocusMatch={onFocusMatch}
          />
        </div>
      )}
    </div>
  );
}

function AnalysisViewContent({
  bundle,
  onArtifactExpired,
  onFocusMatch,
}: {
  bundle: SeriesAnalysisBundle;
  onArtifactExpired: () => void;
  onFocusMatch: (matchId: string) => void;
}) {
  // A drilldown belongs to one artifact/view. This subtree remounts when either identity changes,
  // while the tab lists remain mounted so their focus does not move back to the document.
  const [drilldown, setDrilldown] = useState<SeriesAnalysisDrilldownSelection | null>(null);
  const focusedItemIds = bundle.matchContext?.match?.focusedItemIds ?? [];
  const baseQuery: SeriesAnalysisQuery = {
    artifactId: bundle.aggregate.artifact.artifactId,
    gameTitleId: bundle.aggregate.artifact.gameTitleId,
    mapMasterId: bundle.aggregate.scope.mapMasterId,
    seasonMasterId: bundle.aggregate.scope.seasonMasterId,
  };

  return (
    <>
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
      <MetricDefinitions response={bundle.aggregate} />
      <SeriesAnalysisDrilldownDialog
        baseQuery={baseQuery}
        selection={drilldown}
        onArtifactExpired={onArtifactExpired}
        onClose={() => setDrilldown(null)}
      />
    </>
  );
}
