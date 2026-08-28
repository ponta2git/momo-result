import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { useSeriesAnalysisArtifactRecovery } from "@/features/seriesComparison/page/useSeriesAnalysisArtifactRecovery";
import { isAnalysisClientUpgradeRequired } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";

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

  useEffect(() => {
    if (bundleResolution.kind !== "ready") return;
    setLastSuccessfulBundle((current) =>
      sameSeriesAnalysisDisplayBundle(current, bundleResolution.value)
        ? current
        : bundleResolution.value,
    );
  }, [bundleResolution]);

  useEffect(() => {
    if (
      !candidateResource ||
      bundleResolution.kind !== "waiting" ||
      matchContextQueryParams === undefined ||
      !matchContextFailed
    ) {
      return;
    }
    const fallback = displaySeriesAnalysisBundleWithoutContext(
      activeView,
      candidateAggregate,
      candidateReview,
    );
    if (fallback) {
      setLastSuccessfulBundle((current) =>
        sameSeriesAnalysisDisplayBundle(current, fallback) ? current : fallback,
      );
    }
  }, [
    activeView,
    bundleResolution.kind,
    candidateAggregate,
    candidateResource,
    candidateReview,
    matchContextFailed,
    matchContextQueryParams,
  ]);

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
    bundleResolution.kind === "ready" ? bundleResolution.value : lastSuccessfulBundle;

  useSeriesAnalysisArtifactRecovery({
    activeError,
    activeQuery: activeQueryParams,
    activeView,
    contextError: matchContextError,
    contextQuery: matchContextQueryParams,
    refetchActive,
    refetchContext: refetchMatchContext,
    refetchStatus,
  });

  const bundleFetching =
    activeFetching || (matchContextQueryParams !== undefined && matchContextFetching);
  const displayMatchesActivePurpose =
    activeView === "review"
      ? currentDisplayBundle?.kind === "review"
      : currentDisplayBundle?.kind === "analysis";
  const displayedResource =
    currentDisplayBundle?.kind === "review"
      ? currentDisplayBundle.review
      : currentDisplayBundle?.aggregate;
  const displayMatchesCurrentScope = matchesSeriesAnalysisScope(displayedResource, state);
  const scopeSettling =
    seriesAnalysisScopeSignature(state) !== seriesAnalysisScopeSignature(deferredState);
  const visibleBundle =
    (displayMatchesActivePurpose && displayMatchesCurrentScope) || bundleFetching || scopeSettling
      ? currentDisplayBundle
      : undefined;
  const resourceShielded = shouldShowStaleShield({
    hasVisibleData: visibleBundle !== undefined,
    isPlaceholderData: activePlaceholder,
    isRefreshing: bundleFetching && visibleBundle !== undefined,
    isSettling: scopeSettling || (bundleResolution.kind === "waiting" && bundleFetching),
  });
  const visibleResource =
    visibleBundle?.kind === "review" ? visibleBundle.review : visibleBundle?.aggregate;

  const refresh = useCallback(() => {
    void refetchStatus();
    if (activeQueryParams) void refetchActive();
    if (matchContextQueryParams) void refetchMatchContext();
  }, [
    activeQueryParams,
    matchContextQueryParams,
    refetchActive,
    refetchMatchContext,
    refetchStatus,
  ]);

  return {
    candidateArtifactId,
    clientUpgradeRequired: [statusError, activeError, matchContextError].some(
      isAnalysisClientUpgradeRequired,
    ),
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
      hasError: shouldShowQueryError({ error: activeError, isFetching: activeFetching }),
      loading:
        isInitialQueryLoading({
          data: activeData,
          isFetching: activeFetching,
          isLoading: activeLoading,
        }) ||
        (!candidateResource && activeFetching),
      refreshing: activeFetching && activeData !== undefined,
      shielded: resourceShielded,
    },
    status: {
      data: statusData,
      hasError: shouldShowQueryError({ error: statusError, isFetching: statusFetching }),
      loading: isInitialQueryLoading({
        data: statusData,
        isFetching: statusFetching,
        isLoading: statusLoading,
      }),
      refreshing: statusFetching,
    },
  };
}
