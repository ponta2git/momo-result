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
  deferredSelection,
  selection,
  selectionStatus = "ready",
  deferOutlookAdoption = false,
}: {
  activeView: SeriesAnalysisViewId;
  deferredSelection: SeriesAnalysisSelection;
  selection: SeriesAnalysisSelection;
  selectionStatus?: "ready" | "pending" | "blocked";
  deferOutlookAdoption?: boolean;
}) {
  const selectionReady = selectionStatus === "ready";
  const reads = useSeriesAnalysisReads({
    activeView,
    deferredSelection,
    selection,
    selectionReady,
  });
  const { publishedArtifactId, active, scope, matchContext } = reads;
  const [acceptedBundle, setAcceptedBundle] = useState<SeriesAnalysisDisplayBundle>();
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
        selection,
      }),
    [
      activeView,
      reads.aggregate,
      reads.review,
      reads.outlook,
      matchContext.context,
      publishedArtifactId,
      selection,
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
    previous: acceptedBundle,
    resolution: bundleResolution,
    selection,
  });
  const nextAcceptedBundle =
    adoption.bundle && !sameSeriesAnalysisDisplayBundle(acceptedBundle, adoption.bundle)
      ? adoption.bundle
      : acceptedBundle;
  if (nextAcceptedBundle !== acceptedBundle) setAcceptedBundle(nextAcceptedBundle);

  // Controls stay urgent while a new immutable snapshot renders in the background.
  const deferredBundle = useDeferredValue(nextAcceptedBundle);
  // A definitive invalidation cannot reappear through a deferred predecessor.
  if (matchContext.unavailable && !contextInvalidationPending) {
    setContextInvalidationPending(true);
  } else if (
    !matchContext.unavailable &&
    contextInvalidationPending &&
    deferredBundle === nextAcceptedBundle
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
  const displaySettling = deferredBundle !== nextAcceptedBundle;
  const bundleFetching = active.fetching || (matchContext.requested && matchContext.fetching);
  const visibility = resolveSeriesAnalysisVisibleBundle({
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
      seriesAnalysisScopeSignature(selection) !== seriesAnalysisScopeSignature(deferredSelection),
    selection,
  });

  return {
    candidateArtifactId,
    focus: {
      data: visibility.bundle?.matchContext,
      hasError:
        matchContext.requested &&
        (matchContext.failed ||
          Boolean(
            active.failed &&
            !bundleFetching &&
            visibility.bundle &&
            !visibility.bundle.matchContext,
          )),
      loading: matchContext.requested && matchContext.loading,
      refreshing: matchContext.fetching && matchContext.context !== undefined,
      shielded:
        matchContext.requested && bundleResolution.kind === "waiting" && matchContext.fetching,
    },
    refresh: reads.refresh,
    resolution: bundleResolution,
    resource: {
      bundle: visibility.bundle,
      canRefresh: reads.canRefresh,
      data: seriesAnalysisBundleResource(visibility.bundle),
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
      shielded: visibility.shielded,
    },
    status: reads.status,
  };
}
