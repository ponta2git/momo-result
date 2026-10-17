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
  const locationRequest = useSeriesAnalysisLocationRequest();
  const selectionReads = useSeriesAnalysisSelectionReads(locationRequest.selection);
  const scopeIdentity = useMemo(
    () =>
      resolveSeriesAnalysisScopeIdentity({
        options: selectionReads.options,
        requested: locationRequest.selection,
        identity: selectionReads.identity,
        identityFailed: selectionReads.identityFailed,
      }),
    [
      selectionReads.identity,
      selectionReads.identityFailed,
      selectionReads.options,
      locationRequest.selection,
    ],
  );
  const normalizedSelection = useMemo(
    () => normalizeSeriesAnalysisSelection(scopeIdentity.options, locationRequest.selection),
    [locationRequest.selection, scopeIdentity.options],
  );
  const changeSelection = useCallback(
    (current: SeriesAnalysisSelection, change: SeriesAnalysisSelectionChange) =>
      normalizeSeriesAnalysisSelection(
        scopeIdentity.options,
        changeSeriesAnalysisSelection(current, change),
      ),
    [scopeIdentity.options],
  );
  const selectionLocation = useSeriesAnalysisLocationState({
    request: locationRequest,
    normalizedSelection,
    canonicalizationEnabled: scopeIdentity.options !== undefined,
    changeSelection,
  });
  const resolution = useMemo<SeriesComparisonSelectionResolution>(() => {
    if (scopeIdentity.kind === "pending") {
      return { kind: "pending", reason: scopeIdentity.reason };
    }
    if (!selectionLocation.selection.gameTitleId) return { kind: "empty" };
    const pair = normalizeOutlookPair(
      selectionLocation.selection.focusMemberId,
      selectionLocation.selection.rivalMemberId,
    );
    return {
      kind: "ready",
      comparisonKey: outlookComparisonKey(
        seriesAnalysisScopeSignature(selectionLocation.selection),
        [pair.focusMemberId, pair.rivalMemberId],
      ),
    };
  }, [selectionLocation.selection, scopeIdentity]);
  const filterOptions = useMemo(
    () => buildSeriesAnalysisFilterOptions(scopeIdentity.options, selectionLocation.selection),
    [selectionLocation.selection, scopeIdentity.options],
  );
  const optionsFailed = useRetryNotice(selectionReads.failed, selectionReads.refreshing);

  return {
    ...selectionLocation,
    filters: {
      activeView: selectionLocation.activeView,
      ...filterOptions,
      selection: selectionLocation.selection,
      updateGameTitle: selectionLocation.actions.updateGameTitle,
      updateMapMasterId: selectionLocation.actions.updateMapMasterId,
      updateSeasonMasterId: selectionLocation.actions.updateSeasonMasterId,
      updateView: selectionLocation.actions.updateView,
      updateOwnerMetric: selectionLocation.actions.updateOwnerMetric,
      updateOutlookMember: selectionLocation.actions.updateOutlookMember,
    },
    options: {
      hasError: optionsFailed,
      hasVisibleData: selectionReads.options !== undefined,
      loading: !optionsFailed && selectionReads.loading,
      refreshing: selectionReads.refreshing,
    },
    refresh: selectionReads.refresh,
    resolution,
  };
}
