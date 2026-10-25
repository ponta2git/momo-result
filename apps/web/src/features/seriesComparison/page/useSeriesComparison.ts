import { useIsFetching } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { seriesAnalysisFocusExclusionNotice } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { useOutlookComparisonLifecycle } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useSeriesAnalysisDisplay } from "@/features/seriesComparison/page/useSeriesAnalysisDisplay";
import { useSeriesComparisonSelection } from "@/features/seriesComparison/page/useSeriesComparisonSelection";
import { achievementKeys } from "@/shared/api/achievementQueryOptions";

/** Composes selection controls and the accepted comparison into the display-ready page contract. */
export function useSeriesComparison() {
  const [focusNotice, setFocusNotice] = useState<string | undefined>();
  const selectionControls = useSeriesComparisonSelection();
  const {
    clearFocusedMatch,
    clearScope,
    focusMatch: focusMatchInLocation,
  } = selectionControls.actions;
  const selectionResolution = selectionControls.resolution;
  const deferOutlookAdoption = useOutlookComparisonLifecycle(selectionResolution);
  const display = useSeriesAnalysisDisplay({
    activeView: selectionControls.activeView,
    deferredSelection: selectionControls.deferredSelection,
    selection: selectionControls.selection,
    selectionStatus:
      selectionResolution.kind === "pending"
        ? selectionControls.options.hasError && !selectionControls.options.refreshing
          ? "blocked"
          : "pending"
        : "ready",
    deferOutlookAdoption,
  });
  const refreshDisplay = display.refresh;
  const achievementsFetching =
    useIsFetching({
      queryKey: achievementKeys.publication(
        selectionControls.selection.gameTitleId,
        display.status.data?.currentArtifact?.artifactId,
      ),
      exact: true,
    }) > 0;

  const excludedFocusNotice =
    display.resolution.kind === "excluded" &&
    selectionControls.selection.focusMatchId &&
    display.candidateArtifactId
      ? seriesAnalysisFocusExclusionNotice(display.resolution.status)
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
  const refreshSelection = selectionControls.refresh;
  const refresh = useCallback(() => {
    refreshSelection();
    refreshDisplay();
  }, [refreshDisplay, refreshSelection]);

  return {
    achievementsFetching,
    actions: {
      clearFocusedMatch,
      clearScope,
      focusMatch,
      refresh,
    },
    filters: selectionControls.filters,
    focus: {
      ...display.focus,
      notice: focusNotice,
    },
    options: selectionControls.options,
    resource: display.resource,
    displayIntent: selectionControls.displayIntent,
    normalizationNotice: selectionControls.normalizationNotice,
    status: display.status,
  };
}
