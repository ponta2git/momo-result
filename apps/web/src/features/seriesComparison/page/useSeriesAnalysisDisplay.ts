import { useDeferredValue, useMemo, useState } from "react";

import {
  prepareSeriesAnalysisDisplayBundle,
  retainSeriesAnalysisDisplayBundle,
  resolveSeriesAnalysisVisibleBundle,
  sameSeriesAnalysisDisplayBundle,
  seriesAnalysisScopeSignature,
  seriesAnalysisBundleResource,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { useSeriesAnalysisReads } from "@/features/seriesComparison/page/useSeriesAnalysisReads";

/** Owns the accepted/displayed comparison snapshot, independently from reads execution. */
export function useSeriesAnalysisDisplay({
  activeView,
  deferredState,
  state,
  selectionStatus = "ready",
  deferOutlookAdoption = false,
}: {
  activeView: SeriesAnalysisViewId;
  deferredState: SeriesAnalysisSelection;
  state: SeriesAnalysisSelection;
  selectionStatus?: "ready" | "pending" | "blocked";
  deferOutlookAdoption?: boolean;
}) {
  const selectionReady = selectionStatus === "ready";
  const reads = useSeriesAnalysisReads({ activeView, deferredState, state, selectionReady });
  const { publishedArtifactId, active, scope, matchContext } = reads;
  const [lastSuccessfulBundle, setLastSuccessfulBundle] = useState<SeriesAnalysisDisplayBundle>();
  const [contextInvalidationPending, setContextInvalidationPending] = useState(false);
  const { candidate, resolution: bundleResolution } = useMemo(
    () =>
      prepareSeriesAnalysisDisplayBundle({
        activeView,
        aggregate: reads.aggregate,
        artifactId: publishedArtifactId,
        matchContext: matchContext.context,
        review: reads.review,
        outlook: reads.outlook,
        state,
      }),
    [
      activeView,
      reads.aggregate,
      reads.review,
      reads.outlook,
      matchContext.context,
      publishedArtifactId,
      state,
    ],
  );
  const candidateResource = seriesAnalysisBundleResource(candidate);
  const candidateArtifactId = candidateResource?.artifact.artifactId;

  const adoption = retainSeriesAnalysisDisplayBundle({
    activeView,
    candidate,
    deferOutlookAdoption,
    failed: active.failed,
    matchContextFailed: matchContext.failed,
    matchContextRequested: matchContext.requested,
    matchContextUnavailable: matchContext.unavailable,
    previous: lastSuccessfulBundle,
    resolution: bundleResolution,
    state,
  });
  const currentDisplayBundle =
    adoption.bundle && !sameSeriesAnalysisDisplayBundle(lastSuccessfulBundle, adoption.bundle)
      ? adoption.bundle
      : lastSuccessfulBundle;
  if (currentDisplayBundle !== lastSuccessfulBundle) setLastSuccessfulBundle(currentDisplayBundle);

  // Controls stay urgent while a new immutable snapshot renders in the background.
  const deferredBundle = useDeferredValue(currentDisplayBundle);
  // A definitive invalidation cannot reappear through a deferred predecessor.
  if (matchContext.unavailable && !contextInvalidationPending) {
    setContextInvalidationPending(true);
  } else if (
    !matchContext.unavailable &&
    contextInvalidationPending &&
    deferredBundle === currentDisplayBundle
  ) {
    setContextInvalidationPending(false);
  }
  const suppressDeferredContext = matchContext.unavailable || contextInvalidationPending;
  const displayedBundle = useMemo(
    () =>
      suppressDeferredContext && deferredBundle?.matchContext
        ? { ...deferredBundle, matchContext: undefined }
        : deferredBundle,
    [deferredBundle, suppressDeferredContext],
  );
  const displaySettling = deferredBundle !== currentDisplayBundle;
  const bundleFetching = active.fetching || (matchContext.requested && matchContext.fetching);
  const visible = resolveSeriesAnalysisVisibleBundle({
    activeView,
    artifactId: publishedArtifactId,
    bundle: displayedBundle,
    bundleFetching,
    displaySettling,
    outlookAdoptionDeferred: adoption.kind === "outlook-deferred",
    resolution: bundleResolution,
    scopeAvailable: "query" in reads.plan,
    scopePending: selectionReady && scope.fetching && !scope.hasData,
    scopeSettling:
      seriesAnalysisScopeSignature(state) !== seriesAnalysisScopeSignature(deferredState),
    state,
  });

  return {
    candidateArtifactId,
    focus: {
      data: visible.bundle?.matchContext,
      hasError:
        matchContext.requested &&
        (matchContext.failed ||
          Boolean(
            active.failed && !bundleFetching && visible.bundle && !visible.bundle.matchContext,
          )),
      loading: matchContext.requested && matchContext.loading,
      refreshing: matchContext.fetching && matchContext.context !== undefined,
      shielded:
        matchContext.requested && bundleResolution.kind === "waiting" && matchContext.fetching,
    },
    refresh: reads.refresh,
    resolution: bundleResolution,
    resource: {
      bundle: visible.bundle,
      canRefresh: reads.canRefresh,
      data: seriesAnalysisBundleResource(visible.bundle),
      hasError: reads.hasError,
      unavailableReason: reads.plan.kind === "unavailable" ? reads.plan.reason : undefined,
      // The accepted scope and input interactivity follow the same gesture adoption gate.
      scopeState:
        adoption.kind === "outlook-deferred"
          ? adoption.bundle.outlook.scope.matchCount === 0
            ? ("empty" as const)
            : ("available" as const)
          : scope.state,
      loading:
        adoption.kind !== "outlook-deferred" &&
        (selectionStatus === "pending" ||
          scope.loading ||
          active.loading ||
          (!candidateResource && active.fetching) ||
          (displaySettling && displayedBundle === undefined)),
      refreshing: (active.fetching && active.hasData) || scope.fetching,
      shielded: visible.shielded,
    },
    status: reads.status,
  };
}
