import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import {
  outlookResultView,
  buildOutlookComparisonView,
  buildOutlookOutcomeView,
  buildOutlookWorkspaceLinks,
  outlookGoalHorizonView,
  outlookToolbarView,
} from "@/features/seriesComparison/outlook/outlookProjections";
import type { OutlookResultView } from "@/features/seriesComparison/outlook/outlookProjections";
import {
  useOutlookEdit,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

/** Draft text and reference disclosure never change this result snapshot. */
export function useOutlookResultView(): OutlookResultView {
  return useOutlookProjection(outlookResultView);
}
export function useOutlookToolbar() {
  const view = useOutlookProjection(outlookToolbarView);
  const edit = useOutlookEdit();
  return {
    view,
    undo: () => edit({ kind: "undo" }),
    pin: () => edit({ kind: "pin" }),
    unpin: () => edit({ kind: "unpin" }),
  };
}

export function useOutlookGoalHorizon() {
  const view = useOutlookProjection(outlookGoalHorizonView);
  const edit = useOutlookEdit();
  return {
    view,
    change: (next: { horizon: number; horizonText: string }) =>
      edit({ kind: "horizon", target: "goal", horizon: next.horizon, text: next.horizonText }),
  };
}

export function useOutlookWorkspace(
  summary: SeriesAnalysisOutlookSummary,
  selection: SeriesAnalysisSelection,
) {
  const view = useOutlookResultView();
  const edit = useOutlookEdit();
  const location = useLocation();
  const comparison = useMemo(
    () => buildOutlookComparisonView(summary, selection.focusMemberId, selection.rivalMemberId),
    [summary, selection.focusMemberId, selection.rivalMemberId],
  );
  const { cumulative, names } = comparison;
  const { focus, rival, horizon } = view;
  const result = useMemo(
    () => buildOutlookOutcomeView(cumulative, focus, rival, names, horizon),
    [cumulative, focus, rival, names, horizon],
  );
  const links = buildOutlookWorkspaceLinks(
    location,
    selection,
    summary.artifact.gameTitleId,
    comparison.memberIds[0],
  );
  return { view, edit, ...comparison, ...result, ...links };
}
