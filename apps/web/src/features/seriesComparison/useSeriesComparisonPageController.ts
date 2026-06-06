import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import {
  availableScopeKinds,
  buildSeriesComparisonSearchParams,
  defaultSeriesComparisonView,
  findSelectedSeries,
  normalizeSeriesComparisonSelection,
  parseSeriesComparisonSearchParams,
  scopeNameForState,
  seriesComparisonQueryFromState,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import type { SeriesComparisonViewId } from "@/features/seriesComparison/seriesComparisonViewModel";
import { shouldShowBlockingQueryError, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesComparisonKeys } from "@/shared/api/queryKeys";
import { getSeriesComparison, getSeriesComparisonOptions } from "@/shared/api/seriesComparison";
import type { SeriesComparisonScopeKind } from "@/shared/api/seriesComparison";

export function useSeriesComparisonPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawState = useMemo(() => parseSeriesComparisonSearchParams(searchParams), [searchParams]);

  const optionsQuery = useQuery({
    queryFn: ({ signal }) => getSeriesComparisonOptions({ signal }),
    queryKey: seriesComparisonKeys.options(),
  });

  const normalizedState = useMemo(
    () => normalizeSeriesComparisonSelection(optionsQuery.data, rawState),
    [optionsQuery.data, rawState],
  );
  const aggregateQueryParams = useMemo(
    () => seriesComparisonQueryFromState(normalizedState),
    [normalizedState],
  );

  useEffect(() => {
    if (!optionsQuery.data) {
      return;
    }
    const next = buildSeriesComparisonSearchParams(normalizedState);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [normalizedState, optionsQuery.data, searchParams, setSearchParams]);

  const aggregateQuery = useQuery({
    enabled: aggregateQueryParams !== undefined,
    queryFn: ({ signal }) => {
      if (!aggregateQueryParams) {
        throw new Error("series comparison query is not ready");
      }
      return getSeriesComparison(aggregateQueryParams, { signal });
    },
    queryKey: seriesComparisonKeys.aggregate(aggregateQueryParams),
  });

  const selectedSeries = findSelectedSeries(optionsQuery.data, normalizedState.gameTitleId);
  const scopeKinds = selectedSeries ? availableScopeKinds(selectedSeries) : [];
  const scopeOptions =
    normalizedState.scopeKind === "season"
      ? (selectedSeries?.seasons ?? [])
      : normalizedState.scopeKind === "map"
        ? (selectedSeries?.maps ?? [])
        : [];

  const updateState = (next: typeof normalizedState): void => {
    setSearchParams(buildSeriesComparisonSearchParams(next), { replace: true });
  };

  return {
    aggregate: aggregateQuery.data,
    aggregateLoading:
      aggregateQuery.isLoading || (aggregateQuery.data === undefined && aggregateQuery.isFetching),
    aggregateRefreshing: aggregateQuery.isFetching && aggregateQuery.data !== undefined,
    canRefresh: aggregateQueryParams !== undefined,
    hasAggregateError: shouldShowBlockingQueryError(aggregateQuery),
    hasOptionsError: shouldShowQueryError(optionsQuery),
    options: optionsQuery.data,
    optionsLoading:
      optionsQuery.isLoading || (optionsQuery.data === undefined && optionsQuery.isFetching),
    refresh: () => {
      void optionsQuery.refetch();
      void aggregateQuery.refetch();
    },
    scopeKinds,
    scopeName: scopeNameForState(optionsQuery.data, normalizedState),
    scopeOptions,
    selectedSeries,
    state: normalizedState,
    updateGameTitle: (gameTitleId: string) =>
      updateState({
        gameTitleId,
        scopeKind: "overall",
        view: normalizedState.view ?? defaultSeriesComparisonView,
      }),
    updateScopeId: (scopeId: string) => updateState({ ...normalizedState, scopeId }),
    updateScopeKind: (scopeKind: SeriesComparisonScopeKind) => {
      const series = findSelectedSeries(optionsQuery.data, normalizedState.gameTitleId);
      const firstScopeId =
        scopeKind === "season"
          ? series?.seasons?.[0]?.id
          : scopeKind === "map"
            ? series?.maps?.[0]?.id
            : undefined;
      updateState({
        gameTitleId: normalizedState.gameTitleId,
        scopeKind,
        scopeId: scopeKind === "overall" ? undefined : firstScopeId,
        view: normalizedState.view ?? defaultSeriesComparisonView,
      });
    },
    updateView: (view: SeriesComparisonViewId) => updateState({ ...normalizedState, view }),
  };
}
