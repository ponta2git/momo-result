import { useQuery } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

import { preserveSeriesComparisonDrilldownParams } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownUrlState";
import {
  buildSeriesComparisonSearchParams,
  defaultSeriesComparisonView,
  findSelectedSeries,
  normalizeSeriesComparisonSelection,
  parseSeriesComparisonSearchParams,
  scopeNameForState,
  seriesComparisonQueryFromState,
  seriesComparisonReviewQueryFromState,
} from "@/features/seriesComparison/model/seriesComparisonViewModel";
import type {
  SeriesComparisonUrlState,
  SeriesComparisonViewId,
} from "@/features/seriesComparison/model/seriesComparisonViewModel";
import {
  isInitialQueryLoading,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import {
  seriesComparisonAggregateQueryOptions,
  seriesComparisonOptionsQueryOptions,
  seriesComparisonReviewQueryOptions,
} from "@/shared/api/queryOptions";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

function scopeSignature(state: SeriesComparisonUrlState): string {
  return [state.gameTitleId ?? "", state.seasonMasterId ?? "", state.mapMasterId ?? ""].join("|");
}

export function useSeriesComparisonPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const rawState = useMemo(() => parseSeriesComparisonSearchParams(searchParams), [searchParams]);
  const [optimisticState, setOptimisticState] = useState<SeriesComparisonUrlState | null>(null);
  const [, startStateTransition] = useTransition();

  const optionsQuery = useQuery(seriesComparisonOptionsQueryOptions());

  const urlState = useMemo(
    () => normalizeSeriesComparisonSelection(optionsQuery.data, rawState),
    [optionsQuery.data, rawState],
  );
  const normalizedState = useMemo(
    () => normalizeSeriesComparisonSelection(optionsQuery.data, optimisticState ?? urlState),
    [optimisticState, optionsQuery.data, urlState],
  );
  const deferredState = useDeferredValue(normalizedState);
  const aggregateQueryParams = useMemo(
    () => seriesComparisonQueryFromState(deferredState),
    [deferredState],
  );
  const reviewQueryParams = useMemo(
    () => seriesComparisonReviewQueryFromState(deferredState),
    [deferredState],
  );
  const urlStateSignature = useMemo(
    () => buildSeriesComparisonSearchParams(urlState).toString(),
    [urlState],
  );
  const normalizedStateSignature = useMemo(
    () => buildSeriesComparisonSearchParams(normalizedState).toString(),
    [normalizedState],
  );
  const activeScopeSignature = useMemo(() => scopeSignature(normalizedState), [normalizedState]);
  const deferredScopeSignature = useMemo(() => scopeSignature(deferredState), [deferredState]);
  const scopeSettling = activeScopeSignature !== deferredScopeSignature;
  const activeView = normalizedState.view ?? defaultSeriesComparisonView;
  const reviewViewSettling = activeView !== (deferredState.view ?? defaultSeriesComparisonView);

  useEffect(() => {
    if (!optionsQuery.data || optimisticState) {
      return;
    }
    const next = preserveSeriesComparisonDrilldownParams(
      searchParams,
      buildSeriesComparisonSearchParams(urlState),
    );
    if (returnTo) next.set("returnTo", returnTo);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [optimisticState, optionsQuery.data, returnTo, searchParams, setSearchParams, urlState]);

  useEffect(() => {
    if (optimisticState && urlStateSignature === normalizedStateSignature) {
      setOptimisticState(null);
    }
  }, [normalizedStateSignature, optimisticState, urlStateSignature]);

  const aggregateQuery = useQuery(seriesComparisonAggregateQueryOptions(aggregateQueryParams));
  const reviewEnabled =
    reviewQueryParams !== undefined && activeView === defaultSeriesComparisonView;
  const reviewQuery = useQuery(
    seriesComparisonReviewQueryOptions(reviewQueryParams, reviewEnabled),
  );

  const selectedSeries = findSelectedSeries(optionsQuery.data, normalizedState.gameTitleId);
  const scopeName = scopeNameForState(optionsQuery.data, normalizedState);

  const seriesSelectOptions = useMemo(
    () =>
      (optionsQuery.data?.series ?? []).map((series) => ({
        label: `${series.name} (${series.confirmedMatchCount}戦)`,
        value: series.gameTitleId,
      })),
    [optionsQuery.data],
  );
  const seasonSelectOptions = useMemo(
    () => [
      { label: "全シーズン", value: "" },
      ...(selectedSeries?.seasons ?? []).map((option) => ({
        label: option.name,
        value: option.id,
      })),
    ],
    [selectedSeries],
  );
  const mapSelectOptions = useMemo(
    () => [
      { label: "全マップ", value: "" },
      ...(selectedSeries?.maps ?? []).map((option) => ({
        label: option.name,
        value: option.id,
      })),
    ],
    [selectedSeries],
  );

  const updateState = useCallback(
    (next: typeof normalizedState, options: { replace?: boolean } = {}): void => {
      const nextState = normalizeSeriesComparisonSelection(optionsQuery.data, next);
      setOptimisticState(nextState);
      startStateTransition(() => {
        const nextParams = preserveSeriesComparisonDrilldownParams(
          searchParams,
          buildSeriesComparisonSearchParams(nextState),
        );
        if (returnTo) nextParams.set("returnTo", returnTo);
        setSearchParams(nextParams, {
          replace: options.replace ?? true,
        });
      });
    },
    [optionsQuery.data, returnTo, searchParams, setSearchParams, startStateTransition],
  );
  const updateGameTitle = useCallback(
    (gameTitleId: string) =>
      updateState({
        focusMatchId: undefined,
        gameTitleId,
        mapMasterId: undefined,
        seasonMasterId: undefined,
        view: normalizedState.view ?? defaultSeriesComparisonView,
      }),
    [normalizedState.view, updateState],
  );
  const updateMapMasterId = useCallback(
    (mapMasterId: string) =>
      updateState({
        ...normalizedState,
        focusMatchId: undefined,
        mapMasterId: mapMasterId || undefined,
      }),
    [normalizedState, updateState],
  );
  const updateSeasonMasterId = useCallback(
    (seasonMasterId: string) =>
      updateState({
        ...normalizedState,
        focusMatchId: undefined,
        seasonMasterId: seasonMasterId || undefined,
        view: normalizedState.view ?? defaultSeriesComparisonView,
      }),
    [normalizedState, updateState],
  );
  const updateView = useCallback(
    (view: SeriesComparisonViewId, options?: { replace?: boolean }) =>
      updateState({ ...normalizedState, view }, options),
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

  const aggregateLoading = isInitialQueryLoading(aggregateQuery);
  const aggregateShielded = shouldShowStaleShield({
    hasVisibleData: aggregateQuery.data !== undefined,
    isPlaceholderData: aggregateQuery.isPlaceholderData,
    isRefreshing: aggregateQuery.isFetching && aggregateQuery.data !== undefined,
    isSettling: scopeSettling,
  });
  const reviewLoading = reviewEnabled && isInitialQueryLoading(reviewQuery);
  const reviewShielded =
    reviewEnabled &&
    shouldShowStaleShield({
      hasVisibleData: reviewQuery.data !== undefined,
      isPlaceholderData: reviewQuery.isPlaceholderData,
      isRefreshing: reviewQuery.isFetching && reviewQuery.data !== undefined,
      isSettling: scopeSettling || reviewViewSettling,
    });
  const refresh = () => {
    void optionsQuery.refetch();
    void aggregateQuery.refetch();
    if (reviewEnabled) {
      void reviewQuery.refetch();
    }
  };
  const retryReview = () => {
    void reviewQuery.refetch();
  };

  return {
    actions: {
      refresh,
    },
    aggregate: {
      canRefresh: aggregateQueryParams !== undefined,
      data: aggregateQuery.data,
      hasError: shouldShowQueryError(aggregateQuery),
      loading: aggregateLoading,
      refreshing: aggregateQuery.isFetching && aggregateQuery.data !== undefined,
      shielded: aggregateShielded,
    },
    filters: {
      activeView,
      clearScope,
      clearFocusedMatch,
      mapOptions: mapSelectOptions,
      scopeLabel: [selectedSeries?.name, scopeName].filter(Boolean).join("・"),
      seasonOptions: seasonSelectOptions,
      seriesOptions: seriesSelectOptions,
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
    review: {
      data: reviewQuery.data,
      hasError: reviewEnabled && shouldShowQueryError(reviewQuery),
      loading: reviewLoading,
      retry: retryReview,
      refreshing: reviewEnabled && reviewQuery.isFetching && reviewQuery.data !== undefined,
      shielded: reviewShielded,
    },
    returnTo,
  };
}
