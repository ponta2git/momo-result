import { lazy, memo, Suspense, useEffect, useState } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent";
import { SeriesAnalysisDrilldownLoading } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownLoading";
import { drilldownTitle } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownPrimitives";
import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { ReviewView } from "@/features/seriesComparison/page/SeriesAnalysisReviewView";
import { SeriesAnalysisSelectedMatch } from "@/features/seriesComparison/page/SeriesAnalysisSelectedMatch";
import { MetricDefinitions } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTabs,
  purposePanelId,
  purposeTabId,
  PurposeTabs,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import type { SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";
import { loadLazyModule } from "@/shared/lib/moduleLoadError";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

const loadOverviewView = () =>
  loadLazyModule(() =>
    import("@/features/seriesComparison/page/SeriesAnalysisOverviewView").then((module) => ({
      default: module.OverviewView,
    })),
  );
const loadDriversView = () =>
  loadLazyModule(() =>
    import("@/features/seriesComparison/page/SeriesAnalysisDriversView").then((module) => ({
      default: module.DriversView,
    })),
  );
const loadFlowView = () =>
  loadLazyModule(() =>
    import("@/features/seriesComparison/page/SeriesAnalysisFlowView").then((module) => ({
      default: module.FlowView,
    })),
  );
const loadContextView = () =>
  loadLazyModule(() =>
    import("@/features/seriesComparison/page/SeriesAnalysisContextView").then((module) => ({
      default: module.ContextView,
    })),
  );
const OverviewView = lazy(loadOverviewView);
const DriversView = lazy(loadDriversView);
const FlowView = lazy(loadFlowView);
const ContextView = lazy(loadContextView);
const SeriesAnalysisDrilldownContent = lazy(() =>
  loadLazyModule(() =>
    import("@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent").then(
      (module) => ({ default: module.SeriesAnalysisDrilldownContent }),
    ),
  ),
);
const noFocusedItemIds: readonly string[] = [];

export function preloadSeriesAnalysisView(view: SeriesAnalysisViewId): void {
  const load =
    view === "overview"
      ? loadOverviewView
      : view === "drivers"
        ? loadDriversView
        : view === "flow"
          ? loadFlowView
          : view === "context"
            ? loadContextView
            : undefined;
  void load?.().catch(() => undefined);
}

type SeriesAnalysisContentProps = {
  bundle: SeriesAnalysisDisplayBundle;
  onArtifactExpired: () => void;
  onClearFocusedMatch: () => void;
  onFocusMatch: (matchId: string) => void;
  onViewChange: (view: SeriesAnalysisViewId, options?: { replace?: boolean }) => void;
};

type SeriesAnalysisBundle = Extract<SeriesAnalysisDisplayBundle, { kind: "analysis" }>;

/**
 * Artifact payloads are immutable and their display bundle preserves reference identity. Keeping
 * this boundary shallow prevents unrelated page feedback from rebuilding chart models and SVG
 * subtrees for an unchanged artifact and selection.
 */
export const SeriesAnalysisContent = memo(function SeriesAnalysisContent(
  props: SeriesAnalysisContentProps,
) {
  return <ArtifactViewContent {...props} />;
});

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
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <AnalysisTabs activeView={bundle.view} onViewChange={onViewChange} />
            <div className="justify-self-start sm:justify-self-end">
              <MetricDefinitions response={bundle.aggregate} />
            </div>
          </div>
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
  const focusedItemIds = bundle.matchContext?.match?.focusedItemIds ?? noFocusedItemIds;
  const baseQuery: SeriesAnalysisQuery = {
    artifactId: bundle.aggregate.artifact.artifactId,
    gameTitleId: bundle.aggregate.artifact.gameTitleId,
    mapMasterId: bundle.aggregate.scope.mapMasterId,
    seasonMasterId: bundle.aggregate.scope.seasonMasterId,
  };

  return (
    <>
      <Suspense fallback={<AnalysisViewLoading view={bundle.view} />}>
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
      </Suspense>
      {drilldown ? (
        <Dialog
          description="比較に使った試合を確認します。"
          open
          popupClassName="max-w-[64rem]"
          title={drilldownTitle(drilldown.metricId)}
          onOpenChange={(open) => {
            if (!open) setDrilldown(null);
          }}
        >
          <Suspense fallback={<SeriesAnalysisDrilldownLoading />}>
            <SeriesAnalysisDrilldownContent
              baseQuery={baseQuery}
              selection={drilldown}
              onArtifactExpired={onArtifactExpired}
            />
          </Suspense>
        </Dialog>
      ) : null}
    </>
  );
}

function AnalysisViewLoading({ view }: { view: SeriesAnalysisBundle["view"] }) {
  return (
    <div
      aria-labelledby={analysisTabId(view)}
      className="grid gap-3"
      id={analysisPanelId(view)}
      role="tabpanel"
    >
      <div aria-label="分析を読み込み中" className="grid gap-3">
        <Skeleton className="min-h-24" />
        <Skeleton className="min-h-64" />
      </div>
    </div>
  );
}
