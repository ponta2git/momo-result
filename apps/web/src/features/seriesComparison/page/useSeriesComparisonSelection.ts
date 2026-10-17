import { useCallback, useMemo } from "react";

import { seriesAnalysisScopeSignature } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import { resolveSeriesAnalysisScopeIdentity } from "@/features/seriesComparison/model/seriesAnalysisScopeIdentity";
import {
  changeSeriesAnalysisSelection,
  normalizeOutlookPair,
  normalizeSeriesAnalysisSelection,
  outlookComparisonKey,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisSelectionChange,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import {
  useSeriesAnalysisLocationRequest,
  useSeriesAnalysisLocationState,
} from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { useSeriesAnalysisSelectionReads } from "@/features/seriesComparison/page/useSeriesAnalysisReads";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type SeriesComparisonSelectionResolution =
  | { kind: "pending"; reason: "options" | "identity" }
  | { kind: "empty" }
  | { kind: "ready"; comparisonKey: string };

/** Resolves the requested scope before it can replace an existing comparison. */
export function useSeriesComparisonSelection() {
  const request = useSeriesAnalysisLocationRequest();
  const reads = useSeriesAnalysisSelectionReads(request.selection);
  const scopeIdentity = useMemo(
    () =>
      resolveSeriesAnalysisScopeIdentity({
        options: reads.options,
        requested: request.selection,
        identity: reads.identity,
        identityFailed: reads.identityFailed,
      }),
    [reads.identity, reads.identityFailed, reads.options, request.selection],
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
  const optionsFailed = useRetryNotice(reads.failed, reads.refreshing);

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
      hasVisibleData: reads.options !== undefined,
      loading: !optionsFailed && reads.loading,
      refreshing: reads.refreshing,
    },
    refresh: reads.refresh,
    resolution,
  };
}
