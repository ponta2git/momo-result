import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useMemo, useState } from "react";

import {
  displaySeriesAnalysisBundleWithoutContext,
  matchesSeriesAnalysisResource,
  matchesSeriesAnalysisScope,
  resolveSeriesAnalysisDisplayBundle,
  sameSeriesAnalysisDisplayBundle,
  seriesAnalysisScopeSignature,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type {
  SeriesAnalysisBundleResolution,
  SeriesAnalysisDisplayBundle,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { seriesAnalysisQueryFromState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import { readSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysisMatchContextState";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/**
 * Owns the complete artifact lifecycle: active query selection, stale display retention,
 * match-context enrichment, bounded artifact-expiry recovery, and display-ready resource states.
 */
export function useSeriesAnalysisResource({
  activeView,
  deferredState,
  state,
}: {
  activeView: SeriesAnalysisViewId;
  deferredState: SeriesAnalysisUrlState;
  state: SeriesAnalysisUrlState;
}) {
  const queryClient = useQueryClient();
  const [lastSuccessfulBundle, setLastSuccessfulBundle] = useState<
    SeriesAnalysisDisplayBundle | undefined
  >();
  const [contextInvalidationPending, setContextInvalidationPending] = useState(false);
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(state.gameTitleId));
  const {
    data: statusData,
    error: statusError,
    isFetching: statusFetching,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = statusQuery;
  const publishedArtifactId = statusData?.currentArtifact?.artifactId;
  const queryParams = useMemo(() => {
    const context = seriesAnalysisQueryFromState(state, publishedArtifactId);
    return {
      aggregate:
        activeView === "review"
          ? undefined
          : seriesAnalysisQueryFromState(deferredState, publishedArtifactId),
      matchContext:
        context && state.focusMatchId ? { ...context, matchId: state.focusMatchId } : undefined,
      review:
        activeView === "review"
          ? seriesAnalysisQueryFromState(state, publishedArtifactId)
          : undefined,
    };
  }, [activeView, deferredState, publishedArtifactId, state]);
  const aggregateQueryParams = queryParams.aggregate;
  const reviewQueryParams = queryParams.review;
  const aggregateQuery = useQuery(seriesAnalysisAggregateQueryOptions(aggregateQueryParams));
  const reviewQuery = useQuery(seriesAnalysisReviewQueryOptions(reviewQueryParams));
  const {
    data: aggregateData,
    error: aggregateError,
    isFetching: aggregateFetching,
    isLoading: aggregateLoading,
    refetch: refetchAggregate,
  } = aggregateQuery;
  const {
    data: reviewData,
    error: reviewError,
    isFetching: reviewFetching,
    isLoading: reviewLoading,
    refetch: refetchReview,
  } = reviewQuery;
  const activeQueryParams = activeView === "review" ? reviewQueryParams : aggregateQueryParams;
  const activeError = activeView === "review" ? reviewError : aggregateError;
  const activeFetching = activeView === "review" ? reviewFetching : aggregateFetching;
  const activeLoading = activeView === "review" ? reviewLoading : aggregateLoading;
  const activeData = activeView === "review" ? reviewData : aggregateData;

  const candidateAggregate = matchesSeriesAnalysisResource(
    aggregateData,
    publishedArtifactId,
    state,
  )
    ? aggregateData
    : undefined;
  const candidateReview = matchesSeriesAnalysisResource(reviewData, publishedArtifactId, state)
    ? reviewData
    : undefined;
  const candidateResource = activeView === "review" ? candidateReview : candidateAggregate;
  const candidateArtifactId = candidateResource?.artifact.artifactId;

  const matchContextQueryParams = queryParams.matchContext;
  const matchContextQuery = useQuery(
    seriesAnalysisMatchContextQueryOptions(matchContextQueryParams),
  );
  const {
    isFetching: matchContextFetching,
    isLoading: matchContextLoading,
    refetch: refetchMatchContext,
  } = matchContextQuery;
  const {
    context: matchContextData,
    error: matchContextError,
    unavailable: matchContextUnavailable,
  } = readSeriesAnalysisMatchContext(matchContextQuery);
  const matchContextFailed = shouldShowQueryError({
    error: matchContextError,
    isFetching: matchContextFetching,
  });
  const bundleResolution = useMemo<SeriesAnalysisBundleResolution>(
    () =>
      resolveSeriesAnalysisDisplayBundle({
        activeView,
        aggregate: candidateAggregate,
        artifactId: publishedArtifactId,
        matchContext: matchContextData,
        review: candidateReview,
        state,
      }),
    [activeView, candidateAggregate, candidateReview, matchContextData, publishedArtifactId, state],
  );

  const resolvedBundle =
    bundleResolution.kind === "ready"
      ? bundleResolution.value
      : candidateResource &&
          bundleResolution.kind === "waiting" &&
          matchContextQueryParams !== undefined &&
          (matchContextFailed || matchContextUnavailable)
        ? displaySeriesAnalysisBundleWithoutContext(activeView, candidateAggregate, candidateReview)
        : undefined;
  const previousResource =
    lastSuccessfulBundle?.kind === "review"
      ? lastSuccessfulBundle.review
      : lastSuccessfulBundle?.aggregate;
  // A failed replacement may leave the previous artifact readable. Apply the requested view
  // to that immutable payload, but never retain a different match's result or highlights.
  const retainedBundle =
    shouldShowQueryError({ error: activeError, isFetching: activeFetching }) &&
    matchesSeriesAnalysisScope(previousResource, state)
      ? displaySeriesAnalysisBundleWithoutContext(
          activeView,
          lastSuccessfulBundle?.kind === "analysis" ? lastSuccessfulBundle.aggregate : undefined,
          lastSuccessfulBundle?.kind === "review" ? lastSuccessfulBundle.review : undefined,
        )
      : undefined;
  if (retainedBundle && !matchContextUnavailable) {
    retainedBundle.matchContext =
      lastSuccessfulBundle?.matchContext?.matchId === state.focusMatchId
        ? lastSuccessfulBundle?.matchContext
        : undefined;
  }
  // A missing replacement aggregate cannot keep a context that the current read invalidated.
  const nextSuccessfulBundle =
    resolvedBundle ??
    (matchContextUnavailable && lastSuccessfulBundle?.matchContext
      ? { ...lastSuccessfulBundle, matchContext: undefined }
      : retainedBundle);
  if (
    nextSuccessfulBundle &&
    !sameSeriesAnalysisDisplayBundle(lastSuccessfulBundle, nextSuccessfulBundle)
  ) {
    setLastSuccessfulBundle(nextSuccessfulBundle);
  }

  const refetchActive = useCallback(
    () => (activeView === "review" ? refetchReview() : refetchAggregate()),
    [activeView, refetchAggregate, refetchReview],
  );
  const currentDisplayBundle =
    nextSuccessfulBundle &&
    !sameSeriesAnalysisDisplayBundle(lastSuccessfulBundle, nextSuccessfulBundle)
      ? nextSuccessfulBundle
      : lastSuccessfulBundle;
  // Keep controls urgent while a new immutable artifact/view renders in the background.
  const deferredBundle = useDeferredValue(currentDisplayBundle);
  // Do not defer a definitive invalidation. Keep this fence until rendering catches up, so
  // changing the selected query cannot briefly restore its invalidated predecessor.
  if (matchContextUnavailable && !contextInvalidationPending) {
    setContextInvalidationPending(true);
  } else if (
    !matchContextUnavailable &&
    contextInvalidationPending &&
    deferredBundle === currentDisplayBundle
  ) {
    setContextInvalidationPending(false);
  }
  const suppressDeferredContext = matchContextUnavailable || contextInvalidationPending;
  const displayedBundle = useMemo(
    () =>
      suppressDeferredContext && deferredBundle?.matchContext
        ? { ...deferredBundle, matchContext: undefined }
        : deferredBundle,
    [deferredBundle, suppressDeferredContext],
  );
  const displaySettling = deferredBundle !== currentDisplayBundle;

  useAnalysisArtifactRecovery({
    artifactId: activeQueryParams?.artifactId,
    error: activeError,
    queryKey:
      activeView === "review"
        ? seriesAnalysisKeys.review(activeQueryParams)
        : seriesAnalysisKeys.aggregate(activeQueryParams),
    refetchArtifact: refetchActive,
    refetchStatus,
  });
  useAnalysisArtifactRecovery({
    artifactId: matchContextQueryParams?.artifactId,
    error: matchContextError,
    queryKey: seriesAnalysisKeys.matchContext(matchContextQueryParams),
    refetchArtifact: refetchMatchContext,
    refetchStatus,
  });

  const bundleFetching =
    activeFetching || (matchContextQueryParams !== undefined && matchContextFetching);
  const displayMatchesActivePurpose =
    activeView === "review"
      ? displayedBundle?.kind === "review"
      : displayedBundle?.kind === "analysis";
  const displayedResource =
    displayedBundle?.kind === "review" ? displayedBundle.review : displayedBundle?.aggregate;
  const displayMatchesCurrentScope = matchesSeriesAnalysisScope(displayedResource, state);
  const scopeSettling =
    seriesAnalysisScopeSignature(state) !== seriesAnalysisScopeSignature(deferredState);
  const visibleBundle =
    (displayMatchesActivePurpose && displayMatchesCurrentScope) ||
    bundleFetching ||
    scopeSettling ||
    displaySettling
      ? displayedBundle
      : undefined;
  // Fetching the same immutable artifact does not invalidate its links, disclosures, or focus.
  // Restrict retained content only while its identity differs from the requested display bundle.
  const resourceShielded =
    visibleBundle !== undefined &&
    (((!matchesSeriesAnalysisResource(displayedResource, publishedArtifactId, state) ||
      visibleBundle.view !== activeView ||
      (visibleBundle.matchContext !== undefined &&
        visibleBundle.matchContext.matchId !== state.focusMatchId)) &&
      (bundleFetching || scopeSettling || displaySettling)) ||
      (bundleResolution.kind === "waiting" && bundleFetching));
  const visibleResource =
    visibleBundle?.kind === "review" ? visibleBundle.review : visibleBundle?.aggregate;

  const refresh = useCallback(() => {
    if (!state.gameTitleId) return;
    void refetchStatus({ cancelRefetch: false }).then((result) => {
      if (result.isError || result.data?.currentArtifact?.artifactId !== publishedArtifactId)
        return;
      // A new publication selects its own queries. Only refresh the same publication's live
      // overlays, using explicit active keys so navigation/unmount cannot retarget this continuation.
      const keys = [
        activeQueryParams
          ? activeView === "review"
            ? seriesAnalysisKeys.review(activeQueryParams)
            : seriesAnalysisKeys.aggregate(activeQueryParams)
          : undefined,
        matchContextQueryParams
          ? seriesAnalysisKeys.matchContext(matchContextQueryParams)
          : undefined,
      ];
      return Promise.all(
        keys.map((queryKey) =>
          queryKey
            ? queryClient.refetchQueries(
                { queryKey, exact: true, type: "active" },
                { cancelRefetch: false },
              )
            : undefined,
        ),
      );
    });
  }, [
    activeQueryParams,
    activeView,
    matchContextQueryParams,
    publishedArtifactId,
    queryClient,
    refetchStatus,
    state.gameTitleId,
  ]);

  const resourceFailed = useRetryNotice(
    shouldShowQueryError({ error: activeError, isFetching: activeFetching }),
    activeFetching,
    `${activeView}:${seriesAnalysisScopeSignature(state)}:${publishedArtifactId ?? ""}`,
  );
  const statusFailed = useRetryNotice(
    shouldShowQueryError({ error: statusError, isFetching: statusFetching }),
    statusFetching,
    state.gameTitleId ?? "",
  );

  return {
    candidateArtifactId,
    focus: {
      data: visibleBundle?.matchContext,
      hasError:
        matchContextQueryParams !== undefined &&
        (matchContextFailed ||
          Boolean(activeError && !bundleFetching && visibleBundle && !visibleBundle.matchContext)),
      loading:
        matchContextQueryParams !== undefined &&
        isInitialQueryLoading({
          data: matchContextData,
          isFetching: matchContextFetching,
          isLoading: matchContextLoading,
        }),
      refreshing: matchContextFetching && matchContextData !== undefined,
      shielded:
        matchContextQueryParams !== undefined &&
        bundleResolution.kind === "waiting" &&
        matchContextFetching,
    },
    refresh,
    resolution: bundleResolution,
    resource: {
      bundle: visibleBundle,
      canRefresh: activeQueryParams !== undefined,
      data: visibleResource,
      hasError: resourceFailed,
      loading:
        isInitialQueryLoading({
          data: activeData,
          isFetching: activeFetching,
          isLoading: activeLoading,
        }) ||
        (!candidateResource && activeFetching) ||
        (displaySettling && displayedBundle === undefined),
      refreshing: activeFetching && activeData !== undefined,
      shielded: resourceShielded,
    },
    status: {
      data: statusData,
      hasError: statusFailed,
      loading:
        !statusFailed &&
        isInitialQueryLoading({
          data: statusData,
          isFetching: statusFetching,
          isLoading: statusLoading,
        }),
      refreshing: statusFetching,
    },
  };
}
