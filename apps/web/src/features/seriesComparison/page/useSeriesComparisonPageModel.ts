import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  seriesAnalysisFocusExclusionNotice,
  seriesAnalysisScopeSignature,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { useSeriesAnalysisLocationState } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { useOutlookSessionStore } from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import { useSeriesAnalysisResource } from "@/features/seriesComparison/page/useSeriesAnalysisResource";
import { useSeriesAnalysisScopeIdentity } from "@/features/seriesComparison/page/useSeriesAnalysisScopeIdentity";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisOptionsQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Composes location, option, and artifact owners into the display-ready page contract. */
export function useSeriesComparisonPageModel() {
  const store = useOutlookSessionStore();
  // The page only needs to defer artifact adoption during a gesture, not observe every edit.
  const deferOutlookAdoption = useSyncExternalStore(store.subscribe, () =>
    Boolean(store.getSnapshot()?.gesture),
  );
  const [focusNotice, setFocusNotice] = useState<string | undefined>();
  const optionsQuery = useQuery(seriesAnalysisOptionsQueryOptions());
  const {
    data: optionsData,
    error: optionsError,
    isFetching: optionsFetching,
    isLoading: optionsLoading,
    refetch: refetchOptions,
  } = optionsQuery;
  const scopeIdentity = useSeriesAnalysisScopeIdentity(optionsData);
  const { isEnabled: identityEnabled, refetch: refetchIdentity } = scopeIdentity.query;
  const location = useSeriesAnalysisLocationState(scopeIdentity.options);
  const {
    clearFocusedMatch,
    clearScope,
    focusMatch: focusMatchInLocation,
    updateGameTitle,
    updateMapMasterId,
    updateSeasonMasterId,
    updateView,
    updateOwnerMetric,
    updateOutlookMember,
  } = location.actions;
  const outlookPair = normalizeOutlookPair(
    location.state.focusMemberId,
    location.state.rivalMemberId,
  );
  const outlookKey = `${seriesAnalysisScopeSignature(location.state)}|${outlookPair.focusMemberId}|${outlookPair.rivalMemberId}`;
  useEffect(() => {
    // A route round-trip may outlive the options cache. Its temporary empty selection
    // is not a new comparison, and must not discard the retained input.
    if (!optionsData || scopeIdentity.pending) return;
    store.update((current) => (current && current.key !== outlookKey ? undefined : current));
  }, [store, optionsData, scopeIdentity.pending, outlookKey]);
  const filterOptions = useMemo(
    () => buildSeriesAnalysisFilterOptions(scopeIdentity.options, location.state),
    [location.state, scopeIdentity.options],
  );
  const analysis = useSeriesAnalysisResource({
    activeView: location.activeView,
    deferredState: location.deferredState,
    state: location.state,
    selectionReady: !scopeIdentity.pending,
    deferOutlookAdoption,
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
    if (identityEnabled) void refetchIdentity();
    refreshAnalysis();
  }, [identityEnabled, refetchIdentity, refetchOptions, refreshAnalysis]);

  const optionsFailed = useRetryNotice(
    shouldShowQueryError({ error: optionsError, isFetching: optionsFetching }) ||
      shouldShowQueryError(scopeIdentity.query),
    optionsFetching || scopeIdentity.query.isFetching,
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
      updateOutlookMember,
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
      refreshing: optionsFetching || scopeIdentity.query.isFetching,
    },
    resource: analysis.resource,
    displayIntent: location.displayIntent,
    normalizationNotice: location.normalizationNotice,
    status: analysis.status,
  };
}
