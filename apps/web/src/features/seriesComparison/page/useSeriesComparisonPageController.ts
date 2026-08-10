import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useSearchParams } from "react-router-dom";

import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import {
  buildSeriesAnalysisSearchParams,
  compatibleMapIds,
  compatibleSeasonIds,
  defaultSeriesAnalysisView,
  normalizeSeriesAnalysisSelection,
  parseSeriesAnalysisSearchParams,
  seriesAnalysisQueryFromState,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import {
  isAnalysisArtifactExpired,
  isAnalysisClientUpgradeRequired,
} from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisOptionsQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/queryOptions";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

function scopeSignature(state: SeriesAnalysisUrlState): string {
  return [state.gameTitleId ?? "", state.seasonMasterId ?? "", state.mapMasterId ?? ""].join("|");
}

export function useSeriesComparisonPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const rawState = useMemo(() => parseSeriesAnalysisSearchParams(searchParams), [searchParams]);
  const [optimisticState, setOptimisticState] = useState<SeriesAnalysisUrlState | null>(null);
  const [, startStateTransition] = useTransition();
  const handledExpiredArtifacts = useRef(new Set<string>());

  const optionsQuery = useQuery(seriesAnalysisOptionsQueryOptions());
  const urlState = useMemo(
    () => normalizeSeriesAnalysisSelection(optionsQuery.data, rawState),
    [optionsQuery.data, rawState],
  );
  const normalizedState = useMemo(
    () => normalizeSeriesAnalysisSelection(optionsQuery.data, optimisticState ?? urlState),
    [optimisticState, optionsQuery.data, urlState],
  );
  const deferredState = useDeferredValue(normalizedState);
  const activeView = normalizedState.view ?? defaultSeriesAnalysisView;
  const filterOptions = useMemo(
    () => buildSeriesAnalysisFilterOptions(optionsQuery.data, normalizedState),
    [normalizedState, optionsQuery.data],
  );
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(normalizedState.gameTitleId));
  const publishedArtifactId = statusQuery.data?.currentArtifact?.artifactId;
  const aggregateQueryParams = useMemo(
    () => seriesAnalysisQueryFromState(deferredState, publishedArtifactId),
    [deferredState, publishedArtifactId],
  );
  const aggregateQuery = useQuery(seriesAnalysisAggregateQueryOptions(aggregateQueryParams));
  const displayArtifactId = aggregateQuery.data?.artifact.artifactId;
  const reviewQueryParams = useMemo(
    () => seriesAnalysisQueryFromState(deferredState, displayArtifactId),
    [deferredState, displayArtifactId],
  );
  const reviewEnabled = reviewQueryParams !== undefined && activeView === "review";
  const reviewQuery = useQuery(seriesAnalysisReviewQueryOptions(reviewQueryParams, reviewEnabled));

  const urlSignature = useMemo(
    () => buildSeriesAnalysisSearchParams(urlState).toString(),
    [urlState],
  );
  const normalizedSignature = useMemo(
    () => buildSeriesAnalysisSearchParams(normalizedState).toString(),
    [normalizedState],
  );

  useEffect(() => {
    if (!optionsQuery.data || optimisticState) return;
    const next = buildSeriesAnalysisSearchParams(urlState);
    if (returnTo) next.set("returnTo", returnTo);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [optimisticState, optionsQuery.data, returnTo, searchParams, setSearchParams, urlState]);

  useEffect(() => {
    if (optimisticState && urlSignature === normalizedSignature) setOptimisticState(null);
  }, [normalizedSignature, optimisticState, urlSignature]);

  useEffect(() => {
    const artifactId = aggregateQueryParams?.artifactId;
    if (!artifactId || handledExpiredArtifacts.current.has(artifactId)) return;
    const expired =
      isAnalysisArtifactExpired(aggregateQuery.error) ||
      isAnalysisArtifactExpired(reviewQuery.error);
    if (!expired) return;
    handledExpiredArtifacts.current.add(artifactId);
    void statusQuery.refetch().then((result) => {
      if (result.data?.currentArtifact?.artifactId === artifactId) {
        return Promise.all([
          aggregateQuery.refetch(),
          ...(reviewEnabled ? [reviewQuery.refetch()] : []),
        ]);
      }
      return undefined;
    });
  }, [aggregateQuery, aggregateQueryParams?.artifactId, reviewEnabled, reviewQuery, statusQuery]);

  const activeScopeSignature = scopeSignature(normalizedState);
  const deferredScopeSignature = scopeSignature(deferredState);
  const scopeSettling = activeScopeSignature !== deferredScopeSignature;
  const aggregateLoading = isInitialQueryLoading(aggregateQuery);
  const aggregateShielded = shouldShowStaleShield({
    hasVisibleData: aggregateQuery.data !== undefined,
    isPlaceholderData: aggregateQuery.isPlaceholderData,
    isRefreshing: aggregateQuery.isFetching && aggregateQuery.data !== undefined,
    isSettling: scopeSettling,
  });
  const reviewArtifactMatches = reviewQuery.data?.artifact.artifactId === displayArtifactId;
  const reviewLoading =
    reviewEnabled && (isInitialQueryLoading(reviewQuery) || !reviewArtifactMatches);
  const reviewShielded =
    reviewEnabled &&
    shouldShowStaleShield({
      hasVisibleData: reviewArtifactMatches,
      isPlaceholderData: reviewQuery.isPlaceholderData,
      isRefreshing: reviewQuery.isFetching && reviewArtifactMatches,
      isSettling: scopeSettling,
    });

  const updateState = useCallback(
    (next: SeriesAnalysisUrlState, options: { replace?: boolean } = {}) => {
      const normalized = normalizeSeriesAnalysisSelection(optionsQuery.data, next);
      setOptimisticState(normalized);
      startStateTransition(() => {
        const params = buildSeriesAnalysisSearchParams(normalized);
        if (returnTo) params.set("returnTo", returnTo);
        setSearchParams(params, { replace: options.replace ?? true });
      });
    },
    [optionsQuery.data, returnTo, setSearchParams],
  );

  const updateGameTitle = useCallback(
    (gameTitleId: string) =>
      updateState({ gameTitleId, view: normalizedState.view ?? defaultSeriesAnalysisView }),
    [normalizedState.view, updateState],
  );
  const updateSeasonMasterId = useCallback(
    (seasonMasterId: string) => {
      const nextSeason = seasonMasterId || undefined;
      const mapIds = compatibleMapIds(optionsQuery.data, normalizedState.gameTitleId, nextSeason);
      const currentMap = normalizedState.mapMasterId;
      updateState({
        ...normalizedState,
        focusMatchId: undefined,
        mapMasterId: currentMap && mapIds && !mapIds.has(currentMap) ? undefined : currentMap,
        seasonMasterId: nextSeason,
      });
    },
    [normalizedState, optionsQuery.data, updateState],
  );
  const updateMapMasterId = useCallback(
    (mapMasterId: string) => {
      const nextMap = mapMasterId || undefined;
      const seasonIds = compatibleSeasonIds(
        optionsQuery.data,
        normalizedState.gameTitleId,
        nextMap,
      );
      const currentSeason = normalizedState.seasonMasterId;
      updateState({
        ...normalizedState,
        focusMatchId: undefined,
        mapMasterId: nextMap,
        seasonMasterId:
          currentSeason && seasonIds && !seasonIds.has(currentSeason) ? undefined : currentSeason,
      });
    },
    [normalizedState, optionsQuery.data, updateState],
  );
  const updateView = useCallback(
    (view: SeriesAnalysisViewId, options?: { replace?: boolean }) =>
      updateState({ ...normalizedState, view }, options),
    [normalizedState, updateState],
  );
  const focusMatch = useCallback(
    (focusMatchId: string) => updateState({ ...normalizedState, focusMatchId }, { replace: false }),
    [normalizedState, updateState],
  );
  const clearFocusedMatch = useCallback(
    () => updateState({ ...normalizedState, focusMatchId: undefined }),
    [normalizedState, updateState],
  );
  const clearScope = useCallback(
    () =>
      updateState({
        ...normalizedState,
        focusMatchId: undefined,
        mapMasterId: undefined,
        seasonMasterId: undefined,
      }),
    [normalizedState, updateState],
  );

  const refresh = () => {
    void optionsQuery.refetch();
    void statusQuery.refetch();
    if (aggregateQueryParams) void aggregateQuery.refetch();
    if (reviewEnabled) void reviewQuery.refetch();
  };
  const clientUpgradeRequired = [
    optionsQuery.error,
    statusQuery.error,
    aggregateQuery.error,
    reviewQuery.error,
  ].some(isAnalysisClientUpgradeRequired);

  return {
    actions: {
      clearFocusedMatch,
      clearScope,
      focusMatch,
      refresh,
      reloadClient: () => window.location.reload(),
    },
    aggregate: {
      canRefresh: aggregateQueryParams !== undefined,
      data: aggregateQuery.data,
      hasError: shouldShowQueryError(aggregateQuery),
      loading: aggregateLoading,
      refreshing: aggregateQuery.isFetching && aggregateQuery.data !== undefined,
      shielded: aggregateShielded,
    },
    clientUpgradeRequired,
    filters: {
      activeView,
      confirmedMatchCount: filterOptions.confirmedMatchCount,
      mapOptions: filterOptions.mapOptions,
      scopeLabel: filterOptions.scopeLabel,
      seasonOptions: filterOptions.seasonOptions,
      seriesOptions: filterOptions.seriesOptions,
      state: normalizedState,
      updateGameTitle,
      updateMapMasterId,
      updateSeasonMasterId,
      updateView,
    },
    options: {
      hasError: shouldShowQueryError(optionsQuery),
      hasVisibleData: optionsQuery.data !== undefined,
      loading: isInitialQueryLoading(optionsQuery),
      refreshing: optionsQuery.isFetching,
    },
    returnTo,
    review: {
      data: reviewArtifactMatches ? reviewQuery.data : undefined,
      hasError: reviewEnabled && shouldShowQueryError(reviewQuery),
      loading: reviewLoading,
      refreshing: reviewEnabled && reviewQuery.isFetching && reviewArtifactMatches,
      shielded: reviewShielded,
    },
    status: {
      data: statusQuery.data,
      hasError: shouldShowQueryError(statusQuery),
      loading: isInitialQueryLoading(statusQuery),
      refreshing: statusQuery.isFetching,
    },
  };
}
