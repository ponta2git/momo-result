import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { seriesAnalysisFocusExclusionNotice } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { useOutlookSessionStore } from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import { useSeriesAnalysisResult } from "@/features/seriesComparison/page/useSeriesAnalysisResult";
import { useSeriesComparisonSelection } from "@/features/seriesComparison/page/useSeriesComparisonSelection";

/** Composes location, option, and artifact owners into the display-ready page contract. */
export function useSeriesComparisonPageModel() {
  const store = useOutlookSessionStore();
  // The page only needs to defer artifact adoption during a gesture, not observe every edit.
  const deferOutlookAdoption = useSyncExternalStore(store.subscribe, () =>
    Boolean(store.getSnapshot()?.gesture),
  );
  const [focusNotice, setFocusNotice] = useState<string | undefined>();
  const selection = useSeriesComparisonSelection();
  const { clearFocusedMatch, clearScope, focusMatch: focusMatchInLocation } = selection.actions;
  const selectionResolution = selection.resolution;
  useEffect(() => {
    if (selectionResolution.kind === "pending") return;
    const comparisonKey =
      selectionResolution.kind === "ready" ? selectionResolution.comparisonKey : undefined;
    store.update((current) => (current?.key === comparisonKey ? current : undefined));
  }, [store, selectionResolution]);
  const analysis = useSeriesAnalysisResult({
    activeView: selection.activeView,
    deferredState: selection.deferredState,
    state: selection.state,
    selectionStatus:
      selectionResolution.kind !== "pending"
        ? "ready"
        : selection.options.hasError && !selection.options.refreshing
          ? "blocked"
          : "pending",
    deferOutlookAdoption,
  });
  const refreshAnalysis = analysis.refresh;

  const excludedFocusNotice =
    analysis.resolution.kind === "excluded" &&
    selection.state.focusMatchId &&
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
  const refreshSelection = selection.refresh;
  const refresh = useCallback(() => {
    refreshSelection();
    refreshAnalysis();
  }, [refreshAnalysis, refreshSelection]);

  return {
    actions: {
      clearFocusedMatch,
      clearScope,
      focusMatch,
      refresh,
    },
    filters: selection.filters,
    focus: {
      ...analysis.focus,
      notice: focusNotice,
    },
    options: selection.options,
    resource: analysis.resource,
    displayIntent: selection.displayIntent,
    normalizationNotice: selection.normalizationNotice,
    status: analysis.status,
  };
}
