import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { seriesAnalysisFocusExclusionNotice } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import { useSeriesAnalysisLocationState } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { useSeriesAnalysisResource } from "@/features/seriesComparison/page/useSeriesAnalysisResource";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisOptionsQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Composes location, option, and artifact owners into the display-ready page contract. */
export function useSeriesComparisonPageModel() {
  const [focusNotice, setFocusNotice] = useState<string | undefined>();
  const optionsQuery = useQuery(seriesAnalysisOptionsQueryOptions());
  const {
    data: optionsData,
    error: optionsError,
    isFetching: optionsFetching,
    isLoading: optionsLoading,
    refetch: refetchOptions,
  } = optionsQuery;
  const location = useSeriesAnalysisLocationState(optionsData);
  const {
    clearFocusedMatch,
    clearScope,
    focusMatch: focusMatchInLocation,
    updateGameTitle,
    updateMapMasterId,
    updateSeasonMasterId,
    updateView,
    updateOwnerMetric,
  } = location.actions;
  const filterOptions = useMemo(
    () => buildSeriesAnalysisFilterOptions(optionsData, location.state),
    [location.state, optionsData],
  );
  const analysis = useSeriesAnalysisResource({
    activeView: location.activeView,
    deferredState: location.deferredState,
    state: location.state,
  });
  const refreshAnalysis = analysis.refresh;

  const excludedFocusNotice =
    analysis.resolution.kind === "excluded" &&
    location.state.focusMatchId &&
    analysis.candidateArtifactId
      ? seriesAnalysisFocusExclusionNotice(analysis.resolution.status)
      : undefined;
  if (excludedFocusNotice !== undefined && focusNotice !== excludedFocusNotice) {
    setFocusNotice(excludedFocusNotice);
  }
  useEffect(() => {
    if (excludedFocusNotice !== undefined) clearFocusedMatch();
  }, [clearFocusedMatch, excludedFocusNotice]);

  const focusMatch = useCallback(
    (focusMatchId: string) => {
      setFocusNotice(undefined);
      focusMatchInLocation(focusMatchId);
    },
    [focusMatchInLocation],
  );
  const refresh = useCallback(() => {
    void refetchOptions();
    refreshAnalysis();
  }, [refetchOptions, refreshAnalysis]);

  const optionsFailed = useRetryNotice(
    shouldShowQueryError({ error: optionsError, isFetching: optionsFetching }),
    optionsFetching,
  );

  return {
    actions: {
      clearFocusedMatch,
      clearScope,
      focusMatch,
      refresh,
    },
    filters: {
      activeView: location.activeView,
      confirmedMatchCount: filterOptions.confirmedMatchCount,
      mapOptions: filterOptions.mapOptions,
      seasonOptions: filterOptions.seasonOptions,
      seriesOptions: filterOptions.seriesOptions,
      state: location.state,
      updateGameTitle,
      updateMapMasterId,
      updateSeasonMasterId,
      updateView,
      updateOwnerMetric,
    },
    focus: {
      ...analysis.focus,
      notice: focusNotice,
    },
    options: {
      hasError: optionsFailed,
      hasVisibleData: optionsData !== undefined,
      loading:
        !optionsFailed &&
        isInitialQueryLoading({
          data: optionsData,
          isFetching: optionsFetching,
          isLoading: optionsLoading,
        }),
      refreshing: optionsFetching,
    },
    resource: analysis.resource,
    returnTo: location.returnTo,
    displayIntent: location.displayIntent,
    normalizationNotice: location.normalizationNotice,
    status: analysis.status,
  };
}
