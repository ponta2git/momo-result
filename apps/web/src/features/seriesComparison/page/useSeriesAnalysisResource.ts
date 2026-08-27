import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  matchesSeriesAnalysisResource,
  matchesSeriesAnalysisScope,
  resolveSeriesAnalysisDisplayBundle,
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
import { useSeriesAnalysisArtifactRecovery } from "@/features/seriesComparison/page/useSeriesAnalysisArtifactRecovery";
import { useSeriesAnalysisQueryParams } from "@/features/seriesComparison/page/useSeriesAnalysisQueryParams";
import { isAnalysisClientUpgradeRequired } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import type {
  SeriesComparisonAggregateV3,
  SeriesComparisonReviewV3,
} from "@/shared/api/seriesAnalysis";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";

function sameDisplayBundle(
  current: SeriesAnalysisDisplayBundle | undefined,
  next: SeriesAnalysisDisplayBundle,
): boolean {
  if (!current || current.kind !== next.kind || current.view !== next.view) return false;
  if (current.kind === "review" && next.kind === "review") {
    return current.review === next.review && current.matchContext === next.matchContext;
  }
  return (
    current.kind === "analysis" &&
    next.kind === "analysis" &&
    current.aggregate === next.aggregate &&
    current.matchContext === next.matchContext
  );
}

function displayBundleWithoutContext(
  activeView: SeriesAnalysisViewId,
  aggregate: SeriesComparisonAggregateV3 | undefined,
  review: SeriesComparisonReviewV3 | undefined,
): SeriesAnalysisDisplayBundle | undefined {
  if (activeView === "review") {
    return review ? { kind: "review", matchContext: undefined, review, view: "review" } : undefined;
  }
  return aggregate
    ? { aggregate, kind: "analysis", matchContext: undefined, view: activeView }
    : undefined;
}

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
  const [displayBundle, setDisplayBundle] = useState<SeriesAnalysisDisplayBundle | undefined>();
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(state.gameTitleId));
  const {
    data: statusData,
    error: statusError,
    isFetching: statusFetching,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = statusQuery;
  const publishedArtifactId = statusData?.currentArtifact?.artifactId;
  const queryParams = useSeriesAnalysisQueryParams({
    activeView,
    artifactId: publishedArtifactId,
    deferredState,
    state,
  });
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
    setDisplayBundle((current) =>
      sameDisplayBundle(current, bundleResolution.value) ? current : bundleResolution.value,
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
    const fallback = displayBundleWithoutContext(activeView, candidateAggregate, candidateReview);
    if (fallback) {
      setDisplayBundle((current) => (sameDisplayBundle(current, fallback) ? current : fallback));
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
    bundleResolution.kind === "ready" ? bundleResolution.value : displayBundle;

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
  const visibleBundle =
    (displayMatchesActivePurpose && displayMatchesCurrentScope) || bundleFetching
      ? currentDisplayBundle
      : undefined;
  const scopeSettling =
    seriesAnalysisScopeSignature(state) !== seriesAnalysisScopeSignature(deferredState);
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
