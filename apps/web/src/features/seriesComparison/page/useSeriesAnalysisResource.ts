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
import {
  isInitialQueryLoading,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
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
    isPlaceholderData: aggregatePlaceholder,
    refetch: refetchAggregate,
  } = aggregateQuery;
  const {
    data: reviewData,
    error: reviewError,
    isFetching: reviewFetching,
    isLoading: reviewLoading,
    isPlaceholderData: reviewPlaceholder,
    refetch: refetchReview,
  } = reviewQuery;

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
    data: matchContextData,
    error: matchContextError,
    isFetching: matchContextFetching,
    isLoading: matchContextLoading,
    refetch: refetchMatchContext,
  } = matchContextQuery;
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

  const nextSuccessfulBundle =
    bundleResolution.kind === "ready"
      ? bundleResolution.value
      : candidateResource &&
          bundleResolution.kind === "waiting" &&
          matchContextQueryParams !== undefined &&
          matchContextFailed
        ? displaySeriesAnalysisBundleWithoutContext(activeView, candidateAggregate, candidateReview)
        : undefined;
  if (
    nextSuccessfulBundle &&
    !sameSeriesAnalysisDisplayBundle(lastSuccessfulBundle, nextSuccessfulBundle)
  ) {
    setLastSuccessfulBundle(nextSuccessfulBundle);
  }

  const activeQueryParams = activeView === "review" ? reviewQueryParams : aggregateQueryParams;
  const activeError = activeView === "review" ? reviewError : aggregateError;
  const activeFetching = activeView === "review" ? reviewFetching : aggregateFetching;
  const activeLoading = activeView === "review" ? reviewLoading : aggregateLoading;
  const activePlaceholder = activeView === "review" ? reviewPlaceholder : aggregatePlaceholder;
  const activeData = activeView === "review" ? reviewData : aggregateData;
  const refetchActive = useCallback(
    () => (activeView === "review" ? refetchReview() : refetchAggregate()),
    [activeView, refetchAggregate, refetchReview],
  );
  const currentDisplayBundle =
    bundleResolution.kind === "ready" &&
    !sameSeriesAnalysisDisplayBundle(lastSuccessfulBundle, bundleResolution.value)
      ? bundleResolution.value
      : lastSuccessfulBundle;
  // Keep controls urgent while a new immutable artifact/view renders in the background.
  const displayedBundle = useDeferredValue(currentDisplayBundle);
  const displaySettling = displayedBundle !== currentDisplayBundle;

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
  const resourceShielded = shouldShowStaleShield({
    hasVisibleData: visibleBundle !== undefined,
    isPlaceholderData: activePlaceholder,
    isRefreshing: bundleFetching && visibleBundle !== undefined,
    isSettling:
      displaySettling || scopeSettling || (bundleResolution.kind === "waiting" && bundleFetching),
  });
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
      hasError: matchContextQueryParams !== undefined && matchContextFailed,
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
