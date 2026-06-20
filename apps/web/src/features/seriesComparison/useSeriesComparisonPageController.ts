import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

import {
  buildSeriesComparisonSearchParams,
  defaultSeriesComparisonView,
  findSelectedSeries,
  normalizeSeriesComparisonSelection,
  parseSeriesComparisonSearchParams,
  scopeNameForState,
  seriesComparisonQueryFromState,
  seriesComparisonReviewQueryFromState,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import type {
  SeriesComparisonUrlState,
  SeriesComparisonViewId,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import { seriesComparisonKeys } from "@/shared/api/queryKeys";
import {
  getSeriesComparison,
  getSeriesComparisonOptions,
  getSeriesComparisonReview,
} from "@/shared/api/seriesComparison";

function scopeSignature(state: SeriesComparisonUrlState): string {
  return [state.gameTitleId ?? "", state.seasonMasterId ?? "", state.mapMasterId ?? ""].join("|");
}

export function useSeriesComparisonPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawState = useMemo(() => parseSeriesComparisonSearchParams(searchParams), [searchParams]);
  const [optimisticState, setOptimisticState] = useState<SeriesComparisonUrlState | null>(null);
  const [, startStateTransition] = useTransition();

  const optionsQuery = useQuery({
    queryFn: ({ signal }) => getSeriesComparisonOptions({ signal }),
    queryKey: seriesComparisonKeys.options(),
  });

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
    const next = buildSeriesComparisonSearchParams(urlState);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [optimisticState, optionsQuery.data, searchParams, setSearchParams, urlState]);

  useEffect(() => {
    if (optimisticState && urlStateSignature === normalizedStateSignature) {
      setOptimisticState(null);
    }
  }, [normalizedStateSignature, optimisticState, urlStateSignature]);

  const aggregateQuery = useQuery({
    enabled: aggregateQueryParams !== undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      if (!aggregateQueryParams) {
        throw new Error("series comparison query is not ready");
      }
      return getSeriesComparison(aggregateQueryParams, { signal });
    },
    queryKey: seriesComparisonKeys.aggregate(aggregateQueryParams),
  });
  const reviewEnabled =
    reviewQueryParams !== undefined && activeView === defaultSeriesComparisonView;
  const reviewQuery = useQuery({
    enabled: reviewEnabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      if (!reviewQueryParams) {
        throw new Error("series comparison review query is not ready");
      }
      return getSeriesComparisonReview(reviewQueryParams, { signal });
    },
    queryKey: seriesComparisonKeys.review(reviewQueryParams),
  });

  const selectedSeries = findSelectedSeries(optionsQuery.data, normalizedState.gameTitleId);
  const seasonOptions = selectedSeries?.seasons ?? [];
  const mapOptions = selectedSeries?.maps ?? [];

  const updateState = useCallback(
    (next: typeof normalizedState, options: { replace?: boolean } = {}): void => {
      const nextState = normalizeSeriesComparisonSelection(optionsQuery.data, next);
      setOptimisticState(nextState);
      startStateTransition(() => {
        setSearchParams(buildSeriesComparisonSearchParams(nextState), {
          replace: options.replace ?? true,
        });
      });
    },
    [optionsQuery.data, setSearchParams, startStateTransition],
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

  return {
    aggregate: aggregateQuery.data,
    aggregateLoading,
    aggregateRefreshing: aggregateQuery.isFetching && aggregateQuery.data !== undefined,
    aggregateShielded,
    canRefresh: aggregateQueryParams !== undefined,
    hasAggregateError: shouldShowBlockingQueryError(aggregateQuery),
    hasOptionsError: shouldShowQueryError(optionsQuery),
    hasReviewError: reviewEnabled && shouldShowBlockingQueryError(reviewQuery),
    options: optionsQuery.data,
    optionsLoading: isInitialQueryLoading(optionsQuery),
    refresh: () => {
      void optionsQuery.refetch();
      void aggregateQuery.refetch();
      if (reviewEnabled) {
        void reviewQuery.refetch();
      }
    },
    review: reviewQuery.data,
    reviewLoading,
    reviewRefreshing: reviewEnabled && reviewQuery.isFetching && reviewQuery.data !== undefined,
    reviewShielded,
    mapOptions,
    scopeName: scopeNameForState(optionsQuery.data, normalizedState),
    seasonOptions,
    selectedSeries,
    state: normalizedState,
    updateGameTitle: (gameTitleId: string) =>
      updateState({
        gameTitleId,
        mapMasterId: undefined,
        seasonMasterId: undefined,
        view: normalizedState.view ?? defaultSeriesComparisonView,
      }),
    updateMapMasterId: (mapMasterId: string) =>
      updateState({
        ...normalizedState,
        mapMasterId: mapMasterId || undefined,
      }),
    updateSeasonMasterId: (seasonMasterId: string) =>
      updateState({
        ...normalizedState,
        seasonMasterId: seasonMasterId || undefined,
        view: normalizedState.view ?? defaultSeriesComparisonView,
      }),
    updateView: (view: SeriesComparisonViewId, options?: { replace?: boolean }) =>
      updateState({ ...normalizedState, view }, options),
  };
}
