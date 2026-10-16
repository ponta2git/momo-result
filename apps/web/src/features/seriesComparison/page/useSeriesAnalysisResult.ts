import { useDeferredValue, useMemo, useState } from "react";

import {
  displaySeriesAnalysisBundleWithoutContext,
  matchesSeriesAnalysisResource,
  resolveSeriesAnalysisDisplayBundle,
  retainSeriesAnalysisDisplayBundle,
  resolveSeriesAnalysisVisibleBundle,
  sameSeriesAnalysisDisplayBundle,
  seriesAnalysisScopeSignature,
  seriesAnalysisBundleResource,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type {
  SeriesAnalysisBundleResolution,
  SeriesAnalysisDisplayBundle,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { useSeriesAnalysisResource } from "@/features/seriesComparison/page/useSeriesAnalysisResource";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";

/** Owns the accepted/displayed comparison snapshot, independently from read execution. */
export function useSeriesAnalysisResult({
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
  const read = useSeriesAnalysisResource({ activeView, deferredState, state, selectionReady });
  const { publishedArtifactId, activeQuery, scopeQuery, matchContext } = read;
  const [lastSuccessfulBundle, setLastSuccessfulBundle] = useState<SeriesAnalysisDisplayBundle>();
  const [contextInvalidationPending, setContextInvalidationPending] = useState(false);
  const candidateAggregate = matchesSeriesAnalysisResource(
    read.aggregate,
    publishedArtifactId,
    state,
  )
    ? read.aggregate
    : undefined;
  const candidateReview = matchesSeriesAnalysisResource(read.review, publishedArtifactId, state)
    ? read.review
    : undefined;
  const candidateOutlook = matchesSeriesAnalysisResource(read.outlook, publishedArtifactId, state)
    ? read.outlook
    : undefined;
  const candidateResource =
    activeView === "outlook"
      ? candidateOutlook
      : activeView === "review"
        ? candidateReview
        : candidateAggregate;
  const candidateArtifactId = candidateResource?.artifact.artifactId;

  const bundleResolution = useMemo<SeriesAnalysisBundleResolution>(
    () =>
      resolveSeriesAnalysisDisplayBundle({
        activeView,
        aggregate: candidateAggregate,
        artifactId: publishedArtifactId,
        matchContext: read.matchContext.context,
        review: candidateReview,
        outlook: candidateOutlook,
        state,
      }),
    [
      activeView,
      candidateAggregate,
      candidateReview,
      candidateOutlook,
      read.matchContext.context,
      publishedArtifactId,
      state,
    ],
  );

  const adoption = retainSeriesAnalysisDisplayBundle({
    activeView,
    candidate: displaySeriesAnalysisBundleWithoutContext(
      activeView,
      candidateAggregate,
      candidateReview,
      candidateOutlook,
    ),
    deferOutlookAdoption,
    failed: shouldShowQueryError(activeQuery),
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
  const bundleFetching =
    activeQuery.isFetching || (matchContext.requested && matchContext.fetching);
  const visible = resolveSeriesAnalysisVisibleBundle({
    activeView,
    artifactId: publishedArtifactId,
    bundle: displayedBundle,
    bundleFetching,
    displaySettling,
    outlookAdoptionDeferred: adoption.kind === "outlook-deferred",
    resolution: bundleResolution,
    scopeAvailable: "query" in read.plan,
    scopePending: selectionReady && scopeQuery.isFetching && !scopeQuery.data,
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
            activeQuery.error && !bundleFetching && visible.bundle && !visible.bundle.matchContext,
          )),
      loading: matchContext.requested && matchContext.loading,
      refreshing: matchContext.fetching && matchContext.context !== undefined,
      shielded:
        matchContext.requested && bundleResolution.kind === "waiting" && matchContext.fetching,
    },
    refresh: read.refresh,
    resolution: bundleResolution,
    resource: {
      bundle: visible.bundle,
      canRefresh: read.canRefresh,
      data: seriesAnalysisBundleResource(visible.bundle),
      hasError: read.hasError,
      unavailableReason: read.plan.kind === "unavailable" ? read.plan.reason : undefined,
      // The accepted scope and input interactivity follow the same gesture adoption gate.
      scopeState:
        adoption.kind === "outlook-deferred"
          ? adoption.bundle.outlook.scope.matchCount === 0
            ? ("empty" as const)
            : ("available" as const)
          : scopeQuery.data?.state,
      loading:
        adoption.kind !== "outlook-deferred" &&
        (selectionStatus === "pending" ||
          isInitialQueryLoading(scopeQuery) ||
          isInitialQueryLoading(activeQuery) ||
          (!candidateResource && activeQuery.isFetching) ||
          (displaySettling && displayedBundle === undefined)),
      refreshing:
        (activeQuery.isFetching && activeQuery.data !== undefined) || scopeQuery.isFetching,
      shielded: visible.shielded,
    },
    status: read.status,
  };
}
