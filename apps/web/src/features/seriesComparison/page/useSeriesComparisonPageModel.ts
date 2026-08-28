import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { seriesAnalysisFocusExclusionNotice } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import { useSeriesAnalysisLocationState } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { useSeriesAnalysisResource } from "@/features/seriesComparison/page/useSeriesAnalysisResource";
import { isAnalysisClientUpgradeRequired } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisOptionsQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";

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

  useEffect(() => {
    const focusMatchId = location.state.focusMatchId;
    if (analysis.resolution.kind !== "excluded" || !focusMatchId || !analysis.candidateArtifactId) {
      return;
    }
    setFocusNotice(seriesAnalysisFocusExclusionNotice(analysis.resolution.status));
    clearFocusedMatch();
  }, [
    analysis.candidateArtifactId,
    analysis.resolution,
    clearFocusedMatch,
    location.state.focusMatchId,
  ]);

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

  return {
    actions: {
      clearFocusedMatch,
      clearScope,
      focusMatch,
      refresh,
      reloadClient: () => window.location.reload(),
    },
    clientUpgradeRequired:
      isAnalysisClientUpgradeRequired(optionsError) || analysis.clientUpgradeRequired,
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
    },
    focus: {
      ...analysis.focus,
      notice: focusNotice,
    },
    options: {
      hasError: shouldShowQueryError({ error: optionsError, isFetching: optionsFetching }),
      hasVisibleData: optionsData !== undefined,
      loading: isInitialQueryLoading({
        data: optionsData,
        isFetching: optionsFetching,
        isLoading: optionsLoading,
      }),
      refreshing: optionsFetching,
    },
    resource: analysis.resource,
    returnTo: location.returnTo,
    status: analysis.status,
  };
}
