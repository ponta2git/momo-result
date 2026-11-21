import { lazy, memo, Suspense, useCallback, useRef, useState } from "react";
import type { RefObject } from "react";

import { SeriesAnalysisDrilldownLoading } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownLoading";
import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import {
  seriesAnalysisScopeSignature,
  seriesAnalysisBundleResource,
  seriesAnalysisDisplayedSelection,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type { OwnerMetricId } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/model/seriesAnalysisViewTypes";
import { SeriesAnalysisArrival } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
import { OutlookLoading } from "@/features/seriesComparison/outlook/OutlookLoading";
import { OutlookWorkspaceLoading } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceLoading";
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
import { AnalysisSectionsSkeleton } from "@/features/seriesComparison/page/SeriesComparisonSkeletons";
import type {
  SeriesAnalysisDrilldownMetricId,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";
import { loadLazyModule } from "@/shared/lib/moduleLoadError";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

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
const loadOutlookView = () =>
  loadLazyModule(() =>
    import("@/features/seriesComparison/outlook/workspace/OutlookWorkspaceView").then((module) => ({
      default: module.OutlookWorkspaceView,
    })),
  );
const OutlookView = lazy(loadOutlookView);
const SeriesAnalysisDrilldownContent = lazy(() =>
  loadLazyModule(() =>
    import("@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent").then(
      (module) => ({ default: module.SeriesAnalysisDrilldownContent }),
    ),
  ),
);
const emptyOutlookSelection: SeriesAnalysisSelection = {};
const noFocusedItemIds: readonly string[] = [];

function drilldownTitle(metricId: SeriesAnalysisDrilldownMetricId): string {
  switch (metricId) {
    case "rank.averageHistory":
      return "平均順位の推移";
    case "playOrder.rankHistory":
      return "番手別順位の推移";
    case "expectedRankGap.evidence":
      return "見込みとの差の根拠試合";
  }
}

export function preloadSeriesAnalysisView(view: SeriesAnalysisViewId): void {
  const load =
    view === "overview"
      ? loadOverviewView
      : view === "drivers"
        ? loadDriversView
        : view === "flow"
          ? loadFlowView
          : view === "outlook"
            ? loadOutlookView
            : view === "context"
              ? loadContextView
              : undefined;
  void load?.().catch(() => undefined);
}

type SeriesAnalysisContentProps = {
  expectedRankGapMemberId?: string | undefined;
  onExpectedRankGapMemberChange?: ((memberId: string | undefined) => void) | undefined;
  showPurposeTabs?: boolean;
  outlookSelection?: SeriesAnalysisSelection;
  onOutlookMemberChange?: (role: "focus" | "rival", memberId: string) => void;
  onOutlookPairChange?: (focusMemberId: string, rivalMemberId: string) => void;
  ownerMetric?: OwnerMetricId | undefined;
  onOwnerMetricChange?: ((metric: OwnerMetricId) => void) | undefined;
  activeView?: SeriesAnalysisViewId;
  bundle: SeriesAnalysisDisplayBundle;
  navigationReady?: boolean;
  shielded?: boolean;
  onArtifactExpired: () => void;
  onClearFocusedMatch: () => void;
  onFocusMatch: (matchId: string) => void;
  onViewChange: (view: SeriesAnalysisViewId, options?: { replace?: boolean }) => void;
};

type SeriesAnalysisBundle = Extract<SeriesAnalysisDisplayBundle, { kind: "analysis" }>;
type DrilldownDialogState = {
  open: boolean;
  selection: SeriesAnalysisDrilldownSelection;
};

/**
 * Artifact payloads are immutable and their display bundle preserves reference identity. Keeping
 * this boundary shallow prevents unrelated page feedback from rebuilding chart models and SVG
 * subtrees for an unchanged artifact and selection.
 */
export const SeriesAnalysisContent = memo(function SeriesAnalysisContent({
  expectedRankGapMemberId,
  onExpectedRankGapMemberChange,
  bundle,
  activeView = bundle.view,
  navigationReady = true,
  shielded = false,
  ownerMetric = "rank.average",
  onOwnerMetricChange,
  onArtifactExpired,
  onClearFocusedMatch,
  onFocusMatch,
  onViewChange,
  showPurposeTabs = true,
  outlookSelection = emptyOutlookSelection,
  onOutlookMemberChange,
  onOutlookPairChange,
}: SeriesAnalysisContentProps) {
  const resource = seriesAnalysisBundleResource(bundle);
  const { matchContext } = bundle;
  const artifactId = resource.artifact.artifactId;
  const displayedSelection = seriesAnalysisDisplayedSelection(bundle, outlookSelection);
  // Prototype: the released layout stays reachable for trials, with its own skeleton.
  const outlookLoading =
    outlookSelection.outlookLayout === "current" ? <OutlookLoading /> : <OutlookWorkspaceLoading />;
  const scopeIdentity = seriesAnalysisScopeSignature(displayedSelection);
  const contentIdentity = `${artifactId}:${scopeIdentity}:${bundle.view}`;
  const root = useRef<HTMLDivElement>(null);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" ref={root}>
      {matchContext ? (
        <StaleShield
          active={shielded}
          fallback={null}
          statusPlacement="external"
          strategy="preserve-inert"
        >
          <SeriesAnalysisSelectedMatch context={matchContext} onClear={onClearFocusedMatch} />
        </StaleShield>
      ) : null}
      {showPurposeTabs ? <PurposeTabs activeView={activeView} onViewChange={onViewChange} /> : null}
      {activeView === "outlook" ? (
        <div
          aria-labelledby={purposeTabId("outlook")}
          id={purposePanelId("outlook")}
          role="tabpanel"
        >
          {bundle.kind === "outlook" ? (
            <StaleShield
              active={shielded}
              fallback={null}
              statusPlacement="external"
              strategy="preserve-inert"
            >
              <Suspense fallback={outlookLoading}>
                <OutlookView
                  summary={bundle.outlook}
                  selection={displayedSelection}
                  onMemberChange={onOutlookMemberChange}
                  onPairChange={onOutlookPairChange}
                />
                <SeriesAnalysisArrival ready={navigationReady} root={root} />
              </Suspense>
            </StaleShield>
          ) : (
            outlookLoading
          )}
        </div>
      ) : activeView === "review" ? (
        <StaleShield
          active={shielded}
          fallback={null}
          statusPlacement="external"
          strategy="preserve-inert"
        >
          <ReviewView
            key={contentIdentity}
            loading={bundle.kind !== "review"}
            response={bundle.kind === "review" ? bundle.review : undefined}
            showError={false}
            onViewChange={onViewChange}
          />
          <SeriesAnalysisArrival ready={navigationReady && bundle.kind === "review"} root={root} />
        </StaleShield>
      ) : (
        <div
          aria-labelledby={purposeTabId("analysis")}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          id={purposePanelId("analysis")}
          role="tabpanel"
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <AnalysisTabs activeView={activeView} onViewChange={onViewChange} />
            <div className="justify-self-start sm:justify-self-end">
              {bundle.kind === "analysis" ? <MetricDefinitions /> : null}
            </div>
          </div>
          {bundle.kind === "analysis" ? (
            <StaleShield
              active={shielded}
              fallback={null}
              statusPlacement="external"
              strategy="preserve-inert"
            >
              <AnalysisViewContent
                expectedRankGapMemberId={expectedRankGapMemberId}
                onExpectedRankGapMemberChange={onExpectedRankGapMemberChange}
                ownerMetric={ownerMetric}
                onOwnerMetricChange={onOwnerMetricChange}
                bundle={bundle}
                key={contentIdentity}
                navigationReady={navigationReady}
                root={root}
                onArtifactExpired={onArtifactExpired}
                onFocusMatch={onFocusMatch}
              />
            </StaleShield>
          ) : (
            <AnalysisViewLoading view={activeView} />
          )}
        </div>
      )}
    </div>
  );
});

function AnalysisViewContent({
  expectedRankGapMemberId,
  onExpectedRankGapMemberChange,
  ownerMetric,
  onOwnerMetricChange,
  bundle,
  navigationReady,
  root,
  onArtifactExpired,
  onFocusMatch,
}: {
  expectedRankGapMemberId: string | undefined;
  onExpectedRankGapMemberChange: ((memberId: string | undefined) => void) | undefined;
  ownerMetric: OwnerMetricId;
  onOwnerMetricChange: ((metric: OwnerMetricId) => void) | undefined;
  bundle: SeriesAnalysisBundle;
  navigationReady: boolean;
  root: RefObject<HTMLDivElement | null>;
  onArtifactExpired: () => void;
  onFocusMatch: (matchId: string) => void;
}) {
  // A drilldown belongs to one artifact/scope/view. Remount on any identity change,
  // while the tab lists remain mounted so their focus does not move back to the document.
  const [drilldown, setDrilldown] = useState<DrilldownDialogState | null>(null);
  const openDrilldown = useCallback((selection: SeriesAnalysisDrilldownSelection) => {
    setDrilldown({ open: true, selection });
  }, []);
  const focusedItemIds = bundle.matchContext?.match?.focusedItemIds ?? noFocusedItemIds;
  const scope = bundle.aggregate.scope;
  const baseQuery: SeriesAnalysisQuery = {
    artifactId: bundle.aggregate.artifact.artifactId,
    gameTitleId: bundle.aggregate.artifact.gameTitleId,
    mapMasterId: "mapMasterId" in scope ? scope.mapMasterId : undefined,
    seasonMasterId: "seasonMasterId" in scope ? scope.seasonMasterId : undefined,
  };

  return (
    <>
      <Suspense fallback={<AnalysisViewLoading view={bundle.view} />}>
        {bundle.view === "overview" ? (
          <OverviewView
            focusedItemIds={focusedItemIds}
            response={bundle.aggregate}
            onDrilldown={openDrilldown}
          />
        ) : null}
        {bundle.view === "drivers" ? (
          <DriversView
            expectedRankGapMemberId={expectedRankGapMemberId}
            onExpectedRankGapMemberChange={onExpectedRankGapMemberChange}
            focusedItemIds={focusedItemIds}
            response={bundle.aggregate}
            onDrilldown={openDrilldown}
          />
        ) : null}
        {bundle.view === "flow" ? (
          <FlowView
            focusedItemIds={focusedItemIds}
            response={bundle.aggregate}
            onDrilldown={openDrilldown}
            onFocusMatch={onFocusMatch}
          />
        ) : null}
        {bundle.view === "context" ? (
          <ContextView
            focusedOwnerMemberId={bundle.matchContext?.match?.ownerMemberId}
            ownerMetric={ownerMetric}
            onOwnerMetricChange={onOwnerMetricChange}
            focusedItemIds={focusedItemIds}
            response={bundle.aggregate}
            onDrilldown={openDrilldown}
          />
        ) : null}
        <SeriesAnalysisArrival ready={navigationReady} root={root} />
      </Suspense>
      {drilldown ? (
        <Dialog
          description="比較に使った試合を確認します。"
          open={drilldown.open}
          popupClassName="max-w-5xl"
          title={drilldownTitle(drilldown.selection.metricId)}
          onOpenChange={(open) => {
            if (!open) {
              setDrilldown((current) => (current ? { ...current, open: false } : null));
            }
          }}
        >
          <Suspense fallback={<SeriesAnalysisDrilldownLoading />}>
            <SeriesAnalysisDrilldownContent
              baseQuery={baseQuery}
              selection={drilldown.selection}
              onArtifactExpired={onArtifactExpired}
              onFocusMatch={(matchId) => {
                setDrilldown((current) => (current ? { ...current, open: false } : null));
                onFocusMatch(matchId);
              }}
            />
          </Suspense>
        </Dialog>
      ) : null}
    </>
  );
}

function AnalysisViewLoading({ view }: { view: SeriesAnalysisBundle["view"] }) {
  return (
    <div aria-labelledby={analysisTabId(view)} id={analysisPanelId(view)} role="tabpanel">
      <div aria-label="分析を読み込み中" role="status">
        <span className="sr-only">分析を読み込み中</span>
        <AnalysisSectionsSkeleton view={view} />
      </div>
    </div>
  );
}
