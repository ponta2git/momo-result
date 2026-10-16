import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useMemo, useState } from "react";

import {
  displaySeriesAnalysisBundleWithoutContext,
  matchesSeriesAnalysisResource,
  matchesSeriesAnalysisScope,
  resolveSeriesAnalysisDisplayBundle,
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
import { seriesAnalysisQueryFromState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys, seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import { readSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysisMatchContextState";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
  seriesAnalysisOutlookSummaryQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { seriesAnalysisScopeStatusQueryOptions } from "@/shared/api/seriesPlayerRadar";
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
  selectionReady = true,
  deferOutlookAdoption = false,
}: {
  activeView: SeriesAnalysisViewId;
  deferredState: SeriesAnalysisSelection;
  state: SeriesAnalysisSelection;
  selectionReady?: boolean;
  deferOutlookAdoption?: boolean;
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
  const scopeQueryParams = useMemo(
    () =>
      selectionReady && state.gameTitleId && statusData
        ? {
            gameTitleId: state.gameTitleId,
            artifactId: publishedArtifactId,
            seasonMasterId: state.seasonMasterId,
            mapMasterId: state.mapMasterId,
          }
        : undefined,
    [
      publishedArtifactId,
      selectionReady,
      state.gameTitleId,
      state.mapMasterId,
      state.seasonMasterId,
      statusData,
    ],
  );
  const scopeQuery = useQuery(seriesAnalysisScopeStatusQueryOptions(scopeQueryParams));
  const { refetch: refetchScope } = scopeQuery;
  const scopeAvailable =
    scopeQuery.data?.state === "available" ||
    (activeView === "outlook" &&
      !state.seasonMasterId &&
      !state.mapMasterId &&
      scopeQuery.data?.state === "empty");
  const scopePending = selectionReady && scopeQuery.isFetching && !scopeQuery.data;
  const queryParams = useMemo(() => {
    const context = scopeAvailable
      ? seriesAnalysisQueryFromState(state, publishedArtifactId)
      : undefined;
    return {
      aggregate:
        activeView === "review" || activeView === "outlook" || !scopeAvailable
          ? undefined
          : seriesAnalysisQueryFromState(deferredState, publishedArtifactId),
      matchContext:
        activeView !== "outlook" && context && state.focusMatchId
          ? { ...context, matchId: state.focusMatchId }
          : undefined,
      outlook:
        activeView === "outlook" && !state.mapMasterId && scopeAvailable
          ? seriesAnalysisQueryFromState(state, publishedArtifactId)
          : undefined,
      review:
        activeView === "review" && scopeAvailable
          ? seriesAnalysisQueryFromState(state, publishedArtifactId)
          : undefined,
    };
  }, [activeView, deferredState, publishedArtifactId, scopeAvailable, state]);
  const aggregateQueryParams = queryParams.aggregate;
  const reviewQueryParams = queryParams.review;
  const aggregateQuery = useQuery(seriesAnalysisAggregateQueryOptions(aggregateQueryParams));
  const reviewQuery = useQuery(seriesAnalysisReviewQueryOptions(reviewQueryParams));
  const outlookQuery = useQuery(seriesAnalysisOutlookSummaryQueryOptions(queryParams.outlook));
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
  const { refetch: refetchOutlook } = outlookQuery;
  const activeQueryParams =
    activeView === "outlook"
      ? queryParams.outlook
      : activeView === "review"
        ? reviewQueryParams
        : aggregateQueryParams;
  const activeError =
    activeView === "outlook"
      ? outlookQuery.error
      : activeView === "review"
        ? reviewError
        : aggregateError;
  const activeFetching =
    activeView === "outlook"
      ? outlookQuery.isFetching
      : activeView === "review"
        ? reviewFetching
        : aggregateFetching;
  const activeLoading =
    activeView === "outlook"
      ? outlookQuery.isLoading
      : activeView === "review"
        ? reviewLoading
        : aggregateLoading;
  const activeData =
    activeView === "outlook"
      ? outlookQuery.data
      : activeView === "review"
        ? reviewData
        : aggregateData;
  const activeKey =
    activeView === "outlook"
      ? seriesAnalysisKeys.outlookSummary(activeQueryParams)
      : activeView === "review"
        ? seriesAnalysisKeys.review(activeQueryParams)
        : seriesAnalysisKeys.aggregate(activeQueryParams);

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
  const candidateOutlook = matchesSeriesAnalysisResource(
    outlookQuery.data,
    publishedArtifactId,
    state,
  )
    ? outlookQuery.data
    : undefined;
  const candidateResource =
    activeView === "outlook"
      ? candidateOutlook
      : activeView === "review"
        ? candidateReview
        : candidateAggregate;
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
        outlook: candidateOutlook,
        state,
      }),
    [
      activeView,
      candidateAggregate,
      candidateReview,
      candidateOutlook,
      matchContextData,
      publishedArtifactId,
      state,
    ],
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
  const previousResource = seriesAnalysisBundleResource(lastSuccessfulBundle);
  // A failed replacement may leave the previous artifact readable. Apply the requested view
  // to that immutable payload, but never retain a different match's result or highlights.
  const retainedBundle =
    shouldShowQueryError({ error: activeError, isFetching: activeFetching }) &&
    matchesSeriesAnalysisScope(previousResource, state)
      ? displaySeriesAnalysisBundleWithoutContext(
          activeView,
          lastSuccessfulBundle?.kind === "analysis" ? lastSuccessfulBundle.aggregate : undefined,
          lastSuccessfulBundle?.kind === "review" ? lastSuccessfulBundle.review : undefined,
          lastSuccessfulBundle?.kind === "outlook" ? lastSuccessfulBundle.outlook : undefined,
        )
      : undefined;
  if (retainedBundle && retainedBundle.kind !== "outlook" && !matchContextUnavailable) {
    retainedBundle.matchContext =
      lastSuccessfulBundle?.matchContext?.matchId === state.focusMatchId
        ? lastSuccessfulBundle?.matchContext
        : undefined;
  }
  // A missing replacement aggregate cannot keep a context that the current read invalidated.
  const outlookAdoptionDeferred =
    activeView === "outlook" &&
    deferOutlookAdoption &&
    lastSuccessfulBundle?.kind === "outlook" &&
    matchesSeriesAnalysisScope(previousResource, state);
  const nextSuccessfulBundle = outlookAdoptionDeferred
    ? lastSuccessfulBundle
    : (resolvedBundle ??
      (matchContextUnavailable && lastSuccessfulBundle?.matchContext
        ? { ...lastSuccessfulBundle, matchContext: undefined }
        : retainedBundle));
  if (
    nextSuccessfulBundle &&
    !sameSeriesAnalysisDisplayBundle(lastSuccessfulBundle, nextSuccessfulBundle)
  ) {
    setLastSuccessfulBundle(nextSuccessfulBundle);
  }

  const refetchActive = useCallback(
    () =>
      activeView === "outlook"
        ? refetchOutlook()
        : activeView === "review"
          ? refetchReview()
          : refetchAggregate(),
    [activeView, refetchAggregate, refetchReview, refetchOutlook],
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
    artifactId: scopeQueryParams?.artifactId,
    error: scopeQuery.error,
    queryKey: seriesPlayerRadarKeys.scopeStatus(scopeQueryParams),
    refetchArtifact: refetchScope,
    refetchStatus,
  });
  useAnalysisArtifactRecovery({
    artifactId: activeQueryParams?.artifactId,
    error: activeError,
    queryKey: activeKey,
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
    activeView === "outlook"
      ? displayedBundle?.kind === "outlook"
      : activeView === "review"
        ? displayedBundle?.kind === "review"
        : displayedBundle?.kind === "analysis";
  const displayedResource = seriesAnalysisBundleResource(displayedBundle);
  const displayMatchesCurrentScope = matchesSeriesAnalysisScope(displayedResource, state);
  const scopeSettling =
    seriesAnalysisScopeSignature(state) !== seriesAnalysisScopeSignature(deferredState);
  const visibleBundle =
    (outlookAdoptionDeferred || scopeAvailable || scopePending) &&
    ((displayMatchesActivePurpose && displayMatchesCurrentScope) ||
      scopePending ||
      bundleFetching ||
      scopeSettling ||
      displaySettling)
      ? displayedBundle
      : undefined;
  // Fetching the same immutable artifact does not invalidate its links, disclosures, or focus.
  // Restrict retained content only while its identity differs from the requested display bundle.
  const resourceShielded =
    !(
      activeView === "outlook" &&
      visibleBundle?.kind === "outlook" &&
      displayMatchesCurrentScope
    ) &&
    visibleBundle !== undefined &&
    (scopePending ||
      ((!matchesSeriesAnalysisResource(displayedResource, publishedArtifactId, state) ||
        visibleBundle.view !== activeView ||
        (visibleBundle.matchContext !== undefined &&
          visibleBundle.matchContext.matchId !== state.focusMatchId)) &&
        (bundleFetching || scopeSettling || displaySettling)) ||
      (bundleResolution.kind === "waiting" && bundleFetching));
  const visibleResource = seriesAnalysisBundleResource(visibleBundle);

  const refresh = useCallback(() => {
    if (!state.gameTitleId) return;
    void refetchStatus({ cancelRefetch: false }).then(async (result) => {
      if (result.isError || result.data?.currentArtifact?.artifactId !== publishedArtifactId)
        return;
      if (scopeQueryParams) {
        try {
          const scope = await queryClient.fetchQuery({
            ...seriesAnalysisScopeStatusQueryOptions(scopeQueryParams),
            staleTime: 0,
          });
          if (
            scope.state !== "available" &&
            !(
              activeView === "outlook" &&
              scope.state === "empty" &&
              !state.seasonMasterId &&
              !state.mapMasterId
            )
          )
            return;
        } catch {
          return;
        }
      }
      // A new publication selects its own queries. Only refresh the same publication's live
      // overlays, using explicit active keys so navigation/unmount cannot retarget this continuation.
      const keys = [
        activeQueryParams ? activeKey : undefined,
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
    scopeQueryParams,
    activeKey,
    state.seasonMasterId,
    state.mapMasterId,
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
      canRefresh: activeQueryParams !== undefined || scopeQueryParams !== undefined,
      data: visibleResource,
      hasError: resourceFailed || shouldShowQueryError(scopeQuery),
      // Scope may become empty before its new summary arrives. Keep this display gate,
      // the input's interactivity and the old bundle together until the gesture ends.
      scopeState: outlookAdoptionDeferred
        ? lastSuccessfulBundle.outlook.scope.matchCount === 0
          ? ("empty" as const)
          : ("available" as const)
        : scopeQuery.data?.state,
      loading:
        !outlookAdoptionDeferred &&
        (!selectionReady ||
          isInitialQueryLoading(scopeQuery) ||
          isInitialQueryLoading({
            data: activeData,
            isFetching: activeFetching,
            isLoading: activeLoading,
          }) ||
          (!candidateResource && activeFetching) ||
          (displaySettling && displayedBundle === undefined)),
      refreshing: (activeFetching && activeData !== undefined) || scopeQuery.isFetching,
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
