import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { seriesAnalysisScopeSignature } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { planSeriesAnalysisRead } from "@/features/seriesComparison/model/seriesAnalysisReadPlan";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
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

/** Reads a publication and its live overlays, including scoped refresh and expiry recovery. */
export function useSeriesAnalysisResource({
  activeView,
  deferredState,
  state,
  selectionReady,
}: {
  activeView: SeriesAnalysisViewId;
  deferredState: SeriesAnalysisSelection;
  state: SeriesAnalysisSelection;
  selectionReady: boolean;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(state.gameTitleId));
  const { data: statusData, refetch: refetchStatus } = statusQuery;
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
  const plan = useMemo(
    () =>
      planSeriesAnalysisRead({
        activeView,
        artifactId: publishedArtifactId,
        deferredState,
        scopeState: scopeQuery.data?.state,
        state,
      }),
    [activeView, deferredState, publishedArtifactId, scopeQuery.data?.state, state],
  );
  const aggregateParams = plan.kind === "analysis" ? plan.query : undefined;
  const reviewParams = plan.kind === "review" ? plan.query : undefined;
  const outlookParams = plan.kind === "outlook" ? plan.query : undefined;
  const matchContextParams = "matchContext" in plan ? plan.matchContext : undefined;
  const aggregateQuery = useQuery(seriesAnalysisAggregateQueryOptions(aggregateParams));
  const reviewQuery = useQuery(seriesAnalysisReviewQueryOptions(reviewParams));
  const outlookQuery = useQuery(seriesAnalysisOutlookSummaryQueryOptions(outlookParams));
  const matchContextQuery = useQuery(seriesAnalysisMatchContextQueryOptions(matchContextParams));
  const { refetch: refetchAggregate } = aggregateQuery;
  const { refetch: refetchReview } = reviewQuery;
  const { refetch: refetchOutlook } = outlookQuery;
  const { refetch: refetchMatchContext } = matchContextQuery;
  const activeQuery =
    activeView === "outlook"
      ? outlookQuery
      : activeView === "review"
        ? reviewQuery
        : aggregateQuery;
  const activeQueryParams = "query" in plan ? plan.query : undefined;
  const activeKey =
    activeView === "outlook"
      ? seriesAnalysisKeys.outlookSummary(outlookParams)
      : activeView === "review"
        ? seriesAnalysisKeys.review(reviewParams)
        : seriesAnalysisKeys.aggregate(aggregateParams);
  const matchContext = readSeriesAnalysisMatchContext(matchContextQuery);
  const refetchActive = useCallback(
    () =>
      activeView === "outlook"
        ? refetchOutlook()
        : activeView === "review"
          ? refetchReview()
          : refetchAggregate(),
    [activeView, refetchAggregate, refetchReview, refetchOutlook],
  );

  useAnalysisArtifactRecovery({
    artifactId: scopeQueryParams?.artifactId,
    error: scopeQuery.error,
    queryKey: seriesPlayerRadarKeys.scopeStatus(scopeQueryParams),
    refetchArtifact: refetchScope,
    refetchStatus,
  });
  useAnalysisArtifactRecovery({
    artifactId: activeQueryParams?.artifactId,
    error: activeQuery.error,
    queryKey: activeKey,
    refetchArtifact: refetchActive,
    refetchStatus,
  });
  useAnalysisArtifactRecovery({
    artifactId: matchContextParams?.artifactId,
    error: matchContext.error,
    queryKey: seriesAnalysisKeys.matchContext(matchContextParams),
    refetchArtifact: refetchMatchContext,
    refetchStatus,
  });

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
          const refreshedPlan = planSeriesAnalysisRead({
            activeView,
            artifactId: publishedArtifactId,
            deferredState,
            scopeState: scope.state,
            state,
          });
          if (!("query" in refreshedPlan)) return;
        } catch {
          return;
        }
      }
      // A new publication selects its own reads. Captured keys keep a late refresh from
      // retargeting a newer selection or a different page after navigation.
      const keys = [
        activeQueryParams ? activeKey : undefined,
        matchContextParams ? seriesAnalysisKeys.matchContext(matchContextParams) : undefined,
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
    activeKey,
    activeView,
    deferredState,
    matchContextParams,
    publishedArtifactId,
    queryClient,
    refetchStatus,
    scopeQueryParams,
    state,
  ]);

  const resourceFailed = useRetryNotice(
    shouldShowQueryError(activeQuery),
    activeQuery.isFetching,
    `${activeView}:${seriesAnalysisScopeSignature(state)}:${publishedArtifactId ?? ""}`,
  );
  const statusFailed = useRetryNotice(
    shouldShowQueryError(statusQuery),
    statusQuery.isFetching,
    state.gameTitleId ?? "",
  );

  return {
    plan,
    publishedArtifactId,
    activeQuery,
    aggregate: aggregateQuery.data,
    review: reviewQuery.data,
    outlook: outlookQuery.data,
    scopeQuery,
    matchContext: {
      ...matchContext,
      requested: matchContextParams !== undefined,
      failed: shouldShowQueryError({
        error: matchContext.error,
        isFetching: matchContextQuery.isFetching,
      }),
      fetching: matchContextQuery.isFetching,
      loading: isInitialQueryLoading({ ...matchContextQuery, data: matchContext.context }),
    },
    refresh,
    canRefresh: activeQueryParams !== undefined || scopeQueryParams !== undefined,
    hasError: resourceFailed || shouldShowQueryError(scopeQuery),
    status: {
      data: statusData,
      hasError: statusFailed,
      loading: !statusFailed && isInitialQueryLoading(statusQuery),
      refreshing: statusQuery.isFetching,
    },
  };
}
