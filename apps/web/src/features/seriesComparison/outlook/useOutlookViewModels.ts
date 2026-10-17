import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import {
  useOutlookEdit,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import {
  outlookResultView,
  outlookComparisonView,
  outlookResultPresentation,
  outlookWorkspaceLinks,
  outlookGoalHorizonView,
  outlookToolbarView,
} from "@/features/seriesComparison/outlook/outlookViews";
import type { OutlookResultView } from "@/features/seriesComparison/outlook/outlookViews";
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
export { useOutlookEdit as useOutlookIntents } from "@/features/seriesComparison/outlook/OutlookSessionOwner";

export function useOutlookGoalHorizon() {
  const view = useOutlookProjection(outlookGoalHorizonView);
  const edit = useOutlookEdit();
  return {
    view,
    change: (next: { horizon: number; horizonText: string }) =>
      edit({ kind: "horizon", target: "goal", horizon: next.horizon, text: next.horizonText }),
  };
}

export function useOutlookWorkspaceModel(
  response: SeriesAnalysisOutlookSummary,
  selection: SeriesAnalysisSelection,
) {
  const view = useOutlookResultView();
  const edit = useOutlookEdit();
  const location = useLocation();
  const comparison = useMemo(
    () => outlookComparisonView(response, selection.focusMemberId, selection.rivalMemberId),
    [response, selection.focusMemberId, selection.rivalMemberId],
  );
  const { cumulative, names } = comparison;
  const { focus, rival, horizon } = view;
  const result = useMemo(
    () => outlookResultPresentation(cumulative, focus, rival, names, horizon),
    [cumulative, focus, rival, names, horizon],
  );
  const links = outlookWorkspaceLinks(
    location,
    selection,
    response.artifact.gameTitleId,
    comparison.ids[0],
  );
  return { view, edit, ...comparison, ...result, ...links };
}
