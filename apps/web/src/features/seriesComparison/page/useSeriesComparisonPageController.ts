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

import {
  seriesAnalysisFocusExclusionNotice,
  seriesAnalysisScopeSignature,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import {
  buildSeriesAnalysisSearchParams,
  compatibleMapIds,
  compatibleSeasonIds,
  defaultSeriesAnalysisView,
  normalizeSeriesAnalysisSelection,
  parseSeriesAnalysisSearchParams,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { useSeriesAnalysisDisplayBundle } from "@/features/seriesComparison/page/useSeriesAnalysisDisplayBundle";
import { isAnalysisClientUpgradeRequired } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import { seriesAnalysisOptionsQueryOptions } from "@/shared/api/queryOptions";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

export function useSeriesComparisonPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const rawState = useMemo(() => parseSeriesAnalysisSearchParams(searchParams), [searchParams]);
  const [optimisticState, setOptimisticState] = useState<SeriesAnalysisUrlState | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | undefined>();
  const [, startStateTransition] = useTransition();
  const handledExcludedFocus = useRef(new Set<string>());

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
  const resources = useSeriesAnalysisDisplayBundle({
    activeView,
    deferredState,
    state: normalizedState,
  });
  const {
    aggregateQuery,
    aggregateQueryParams,
    bundleResolution,
    candidateArtifactId,
    displayBundle,
    matchContextQuery,
    matchContextQueryParams,
    reviewArtifactMatches,
    reviewEnabled,
    reviewQuery,
    statusQuery,
  } = resources;

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

  const scopeSettling =
    seriesAnalysisScopeSignature(normalizedState) !== seriesAnalysisScopeSignature(deferredState);
  const bundleFetching =
    aggregateQuery.isFetching ||
    (reviewEnabled && reviewQuery.isFetching) ||
    (matchContextQueryParams !== undefined && matchContextQuery.isFetching);
  const aggregateShielded = shouldShowStaleShield({
    hasVisibleData: displayBundle !== undefined,
    isPlaceholderData: aggregateQuery.isPlaceholderData,
    isRefreshing: bundleFetching && displayBundle !== undefined,
    isSettling: scopeSettling || (bundleResolution.kind === "waiting" && bundleFetching),
  });
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
    (focusMatchId: string) => {
      setFocusNotice(undefined);
      updateState({ ...normalizedState, focusMatchId }, { replace: false });
    },
    [normalizedState, updateState],
  );
  const clearFocusedMatch = useCallback(() => {
    updateState({ ...normalizedState, focusMatchId: undefined });
  }, [normalizedState, updateState]);
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

  useEffect(() => {
    const focusMatchId = normalizedState.focusMatchId;
    if (bundleResolution.kind !== "excluded" || !focusMatchId || !candidateArtifactId) return;
    const key = `${candidateArtifactId}:${focusMatchId}:${bundleResolution.status}`;
    if (handledExcludedFocus.current.has(key)) return;
    handledExcludedFocus.current.add(key);
    setFocusNotice(seriesAnalysisFocusExclusionNotice(bundleResolution.status));
    clearFocusedMatch();
  }, [bundleResolution, candidateArtifactId, clearFocusedMatch, normalizedState.focusMatchId]);

  const refresh = () => {
    void optionsQuery.refetch();
    void statusQuery.refetch();
    if (aggregateQueryParams) void aggregateQuery.refetch();
    if (reviewEnabled) void reviewQuery.refetch();
    if (matchContextQueryParams) void matchContextQuery.refetch();
  };
  const clientUpgradeRequired = [
    optionsQuery.error,
    statusQuery.error,
    aggregateQuery.error,
    matchContextQuery.error,
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
      data: displayBundle?.aggregate,
      hasError: shouldShowQueryError(aggregateQuery),
      loading: isInitialQueryLoading(aggregateQuery),
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
    focus: {
      data: displayBundle?.matchContext,
      hasError: matchContextQueryParams !== undefined && shouldShowQueryError(matchContextQuery),
      loading: matchContextQueryParams !== undefined && isInitialQueryLoading(matchContextQuery),
      notice: focusNotice,
      refreshing: matchContextQuery.isFetching && matchContextQuery.data !== undefined,
      shielded:
        matchContextQueryParams !== undefined &&
        bundleResolution.kind === "waiting" &&
        matchContextQuery.isFetching,
    },
    options: {
      hasError: shouldShowQueryError(optionsQuery),
      hasVisibleData: optionsQuery.data !== undefined,
      loading: isInitialQueryLoading(optionsQuery),
      refreshing: optionsQuery.isFetching,
    },
    returnTo,
    review: {
      data: displayBundle?.review,
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
