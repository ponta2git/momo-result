import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { seriesAnalysisScopeSignature } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import {
  resolveSeriesAnalysisScopeIdentity,
  seriesAnalysisScopeIdentityQuery,
} from "@/features/seriesComparison/model/seriesAnalysisScopeIdentity";
import {
  changeSeriesAnalysisSelection,
  normalizeOutlookPair,
  normalizeSeriesAnalysisSelection,
  outlookComparisonKey,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisSelectionChange,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import {
  useSeriesAnalysisLocationRequest,
  useSeriesAnalysisLocationState,
} from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisOptionsQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { seriesAnalysisScopeStatusQueryOptions } from "@/shared/api/seriesPlayerRadar";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type SeriesComparisonSelectionResolution =
  | { kind: "pending"; reason: "options" | "identity" }
  | { kind: "empty" }
  | { kind: "ready"; comparisonKey: string };

/** Resolves the requested scope before it can replace an existing comparison. */
export function useSeriesComparisonSelection() {
  const request = useSeriesAnalysisLocationRequest();
  const optionsQuery = useQuery(seriesAnalysisOptionsQueryOptions());
  const identityQuery = useQuery(
    seriesAnalysisScopeStatusQueryOptions(
      seriesAnalysisScopeIdentityQuery(optionsQuery.data, request.selection),
    ),
  );
  const scopeIdentity = useMemo(
    () =>
      resolveSeriesAnalysisScopeIdentity({
        options: optionsQuery.data,
        requested: request.selection,
        identity: identityQuery.data,
        identityFailed: identityQuery.isError,
      }),
    [identityQuery.data, identityQuery.isError, optionsQuery.data, request.selection],
  );
  const normalizedSelection = useMemo(
    () => normalizeSeriesAnalysisSelection(scopeIdentity.options, request.selection),
    [request.selection, scopeIdentity.options],
  );
  const changeSelection = useCallback(
    (current: SeriesAnalysisSelection, change: SeriesAnalysisSelectionChange) =>
      normalizeSeriesAnalysisSelection(
        scopeIdentity.options,
        changeSeriesAnalysisSelection(current, change),
      ),
    [scopeIdentity.options],
  );
  const location = useSeriesAnalysisLocationState({
    request,
    normalizedSelection,
    canonicalizationEnabled: scopeIdentity.options !== undefined,
    changeSelection,
  });
  const resolution = useMemo<SeriesComparisonSelectionResolution>(() => {
    if (scopeIdentity.kind === "pending") {
      return { kind: "pending", reason: scopeIdentity.reason };
    }
    if (!location.state.gameTitleId) return { kind: "empty" };
    const pair = normalizeOutlookPair(location.state.focusMemberId, location.state.rivalMemberId);
    return {
      kind: "ready",
      comparisonKey: outlookComparisonKey(seriesAnalysisScopeSignature(location.state), [
        pair.focusMemberId,
        pair.rivalMemberId,
      ]),
    };
  }, [location.state, scopeIdentity]);
  const filterOptions = useMemo(
    () => buildSeriesAnalysisFilterOptions(scopeIdentity.options, location.state),
    [location.state, scopeIdentity.options],
  );
  const { refetch: refetchOptions } = optionsQuery;
  const { isEnabled: identityEnabled, refetch: refetchIdentity } = identityQuery;
  const refresh = useCallback(() => {
    void refetchOptions();
    if (identityEnabled) void refetchIdentity();
  }, [identityEnabled, refetchIdentity, refetchOptions]);
  const refreshing = optionsQuery.isFetching || identityQuery.isFetching;
  const optionsFailed = useRetryNotice(
    shouldShowQueryError(optionsQuery) || shouldShowQueryError(identityQuery),
    refreshing,
  );

  return {
    ...location,
    filters: {
      activeView: location.activeView,
      ...filterOptions,
      state: location.state,
      updateGameTitle: location.actions.updateGameTitle,
      updateMapMasterId: location.actions.updateMapMasterId,
      updateSeasonMasterId: location.actions.updateSeasonMasterId,
      updateView: location.actions.updateView,
      updateOwnerMetric: location.actions.updateOwnerMetric,
      updateOutlookMember: location.actions.updateOutlookMember,
    },
    options: {
      hasError: optionsFailed,
      hasVisibleData: optionsQuery.data !== undefined,
      loading: !optionsFailed && isInitialQueryLoading(optionsQuery),
      refreshing,
    },
    refresh,
    resolution,
  };
}
