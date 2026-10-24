import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { seriesAnalysisScopeSignature } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { planSeriesAnalysisRead } from "@/features/seriesComparison/model/seriesAnalysisReadPlan";
import type { SeriesAnalysisReadPlan } from "@/features/seriesComparison/model/seriesAnalysisReadPlan";
import { refreshSeriesAnalysis } from "@/features/seriesComparison/model/seriesAnalysisRefresh";
import { seriesAnalysisScopeIdentityQuery } from "@/features/seriesComparison/model/seriesAnalysisScopeIdentity";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { achievementKeys } from "@/shared/api/achievementQueryOptions";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import type {
  SeriesAnalysisMatchContextV3,
  SeriesAnalysisOptionsResponse,
  SeriesAnalysisOutlookSummary,
  SeriesAnalysisStatusResponse,
  SeriesComparisonAggregate,
  SeriesComparisonReviewV3,
} from "@/shared/api/seriesAnalysis";
import { readSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysisMatchContextState";
import {
  seriesAnalysisOptionsQueryOptions,
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
  seriesAnalysisOutlookSummaryQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import type { SeriesAnalysisScopeStatus } from "@/shared/api/seriesPlayerRadar";
import { seriesAnalysisScopeStatusQueryOptions } from "@/shared/api/seriesPlayerRadarQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type SeriesAnalysisReadActivity = { fetching: boolean; loading: boolean; hasData: boolean };

type SeriesAnalysisReads = {
  plan: SeriesAnalysisReadPlan;
  publishedArtifactId: string | undefined;
  active: SeriesAnalysisReadActivity & { failed: boolean };
  aggregate: SeriesComparisonAggregate | undefined;
  review: SeriesComparisonReviewV3 | undefined;
  outlook: SeriesAnalysisOutlookSummary | undefined;
  scope: SeriesAnalysisReadActivity & { state: SeriesAnalysisScopeStatus["state"] | undefined };
  matchContext: {
    context: SeriesAnalysisMatchContextV3 | undefined;
    unavailable: boolean;
    requested: boolean;
    failed: boolean;
    fetching: boolean;
    loading: boolean;
  };
  refresh: () => void;
  canRefresh: boolean;
  hasError: boolean;
  status: {
    data: SeriesAnalysisStatusResponse | undefined;
    hasError: boolean;
    loading: boolean;
    refreshing: boolean;
  };
};

/** Reads a publication and its live overlays, including scoped refresh and expiry recovery. */
export function useSeriesAnalysisReads({
  activeView,
  deferredSelection,
  selection,
  selectionReady,
}: {
  activeView: SeriesAnalysisViewId;
  deferredSelection: SeriesAnalysisSelection;
  selection: SeriesAnalysisSelection;
  selectionReady: boolean;
}): SeriesAnalysisReads {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(selection.gameTitleId));
  const { data: statusData, refetch: refetchStatus } = statusQuery;
  const publishedArtifactId = statusData?.currentArtifact?.artifactId;
  const scopeQueryParams = useMemo(
    () =>
      selectionReady && selection.gameTitleId && statusData
        ? {
            gameTitleId: selection.gameTitleId,
            artifactId: publishedArtifactId,
            seasonMasterId: selection.seasonMasterId,
            mapMasterId: selection.mapMasterId,
          }
        : undefined,
    [
      publishedArtifactId,
      selectionReady,
      selection.gameTitleId,
      selection.mapMasterId,
      selection.seasonMasterId,
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
        deferredSelection,
        scopeState: scopeQuery.data?.state,
        selection,
      }),
    [activeView, deferredSelection, publishedArtifactId, scopeQuery.data?.state, selection],
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
  const activeResourceKind =
    activeView === "outlook" || activeView === "review" ? activeView : "aggregate";
  const activeKey = useMemo(
    () =>
      activeView === "outlook"
        ? seriesAnalysisKeys.outlookSummary(outlookParams)
        : activeView === "review"
          ? seriesAnalysisKeys.review(reviewParams)
          : seriesAnalysisKeys.aggregate(aggregateParams),
    [activeView, aggregateParams, outlookParams, reviewParams],
  );
  const matchContext = readSeriesAnalysisMatchContext(matchContextQuery);
  const refreshActive = useCallback(async () => {
    if (activeView === "outlook") await refetchOutlook();
    else if (activeView === "review") await refetchReview();
    else await refetchAggregate();
  }, [activeView, refetchAggregate, refetchReview, refetchOutlook]);
  const refreshScopeResource = useCallback(async () => {
    await refetchScope();
  }, [refetchScope]);
  const refreshMatchContext = useCallback(async () => {
    await refetchMatchContext();
  }, [refetchMatchContext]);
  const refreshPublication = useCallback(async () => {
    const result = await refetchStatus({ cancelRefetch: false });
    return result.data?.currentArtifact?.artifactId;
  }, [refetchStatus]);

  useAnalysisArtifactRecovery({
    artifactId: scopeQueryParams?.artifactId,
    error: scopeQuery.error,
    resourceId: JSON.stringify(["scope-status", scopeQueryParams]),
    refreshResource: refreshScopeResource,
    refreshPublication,
  });
  useAnalysisArtifactRecovery({
    artifactId: activeQueryParams?.artifactId,
    error: activeQuery.error,
    resourceId: JSON.stringify([activeResourceKind, activeQueryParams]),
    refreshResource: refreshActive,
    refreshPublication,
  });
  useAnalysisArtifactRecovery({
    artifactId: matchContextParams?.artifactId,
    error: matchContext.error,
    resourceId: JSON.stringify(["match-context", matchContextParams]),
    refreshResource: refreshMatchContext,
    refreshPublication,
  });

  const refresh = useCallback(() => {
    void refreshSeriesAnalysis({
      activeView,
      artifactId: publishedArtifactId,
      deferredSelection,
      selection,
      refreshPublication: async () => {
        const result = await refetchStatus({ cancelRefetch: false });
        const currentArtifactId = result.data?.currentArtifact?.artifactId;
        if (!result.isError && selection.gameTitleId && currentArtifactId) {
          await queryClient.invalidateQueries({
            queryKey: achievementKeys.publication(selection.gameTitleId, currentArtifactId),
            exact: true,
          });
        }
        return result.isError
          ? undefined
          : { artifactId: result.data?.currentArtifact?.artifactId };
      },
      refreshScope: scopeQueryParams
        ? () =>
            queryClient.fetchQuery({
              ...seriesAnalysisScopeStatusQueryOptions(scopeQueryParams),
              staleTime: 0,
            })
        : undefined,
      refreshVisibleResources: async () => {
        // Captured keys and active subscriptions prevent a late refresh from
        // retargeting a newer selection or another page after navigation.
        const keys = [
          activeQueryParams ? activeKey : undefined,
          matchContextParams ? seriesAnalysisKeys.matchContext(matchContextParams) : undefined,
        ];
        await Promise.all(
          keys.map((queryKey) =>
            queryKey
              ? queryClient.refetchQueries(
                  { queryKey, exact: true, type: "active" },
                  { cancelRefetch: false },
                )
              : undefined,
          ),
        );
      },
    });
  }, [
    activeQueryParams,
    activeKey,
    activeView,
    deferredSelection,
    matchContextParams,
    publishedArtifactId,
    queryClient,
    refetchStatus,
    scopeQueryParams,
    selection,
  ]);

  const resourceFailed = useRetryNotice(
    shouldShowQueryError(activeQuery),
    activeQuery.isFetching,
    `${activeView}:${seriesAnalysisScopeSignature(selection)}:${publishedArtifactId ?? ""}`,
  );
  const statusFailed = useRetryNotice(
    shouldShowQueryError(statusQuery),
    statusQuery.isFetching,
    selection.gameTitleId ?? "",
  );

  return {
    plan,
    publishedArtifactId,
    active: {
      failed: shouldShowQueryError(activeQuery),
      fetching: activeQuery.isFetching,
      hasData: activeQuery.data !== undefined,
      loading: isInitialQueryLoading(activeQuery),
    },
    aggregate: aggregateQuery.data,
    review: reviewQuery.data,
    outlook: outlookQuery.data,
    scope: {
      state: scopeQuery.data?.state,
      fetching: scopeQuery.isFetching,
      hasData: scopeQuery.data !== undefined,
      loading: isInitialQueryLoading(scopeQuery),
    },
    matchContext: {
      context: matchContext.context,
      unavailable: matchContext.unavailable,
      requested: matchContextParams !== undefined,
      failed: shouldShowQueryError({
        error: matchContext.error,
        isFetching: matchContextQuery.isFetching,
      }),
      fetching: matchContextQuery.isFetching,
      loading: isInitialQueryLoading({
        data: matchContext.context,
        isFetching: matchContextQuery.isFetching,
        isLoading: matchContextQuery.isLoading,
      }),
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

/** Supplies directory and saved scope identity without choosing or normalizing a selection. */
export function useSeriesAnalysisSelectionReads(requested: SeriesAnalysisSelection): {
  options: SeriesAnalysisOptionsResponse | undefined;
  identity: SeriesAnalysisScopeStatus | undefined;
  identityFailed: boolean;
  failed: boolean;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
} {
  const optionsQuery = useQuery(seriesAnalysisOptionsQueryOptions());
  const identityQuery = useQuery(
    seriesAnalysisScopeStatusQueryOptions(
      seriesAnalysisScopeIdentityQuery(optionsQuery.data, requested),
    ),
  );
  const { refetch: refetchOptions } = optionsQuery;
  const { isEnabled: identityEnabled, refetch: refetchIdentity } = identityQuery;
  const refresh = useCallback(() => {
    void refetchOptions();
    if (identityEnabled) void refetchIdentity();
  }, [identityEnabled, refetchIdentity, refetchOptions]);
  return {
    options: optionsQuery.data,
    identity: identityQuery.data,
    identityFailed: identityQuery.isError,
    failed: shouldShowQueryError(optionsQuery) || shouldShowQueryError(identityQuery),
    loading: isInitialQueryLoading(optionsQuery),
    refreshing: optionsQuery.isFetching || identityQuery.isFetching,
    refresh,
  };
}
