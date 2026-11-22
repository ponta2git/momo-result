import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import {
  buildOutlookComparisonView,
  buildOutlookWorkspaceLinks,
  outlookResultView,
} from "@/features/seriesComparison/outlook/outlookProjections";
import {
  useOutlookEdit,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

/** The comparison's fixed facts and the assumptions the answers read; drafts stay in each input. */
export function useOutlookWorkspace(
  summary: SeriesAnalysisOutlookSummary,
  selection: SeriesAnalysisSelection,
) {
  const view = useOutlookProjection(outlookResultView);
  const edit = useOutlookEdit();
  const location = useLocation();
  const comparison = useMemo(
    () => buildOutlookComparisonView(summary, selection.focusMemberId, selection.rivalMemberId),
    [summary, selection.focusMemberId, selection.rivalMemberId],
  );
  const links = buildOutlookWorkspaceLinks(
    location,
    selection,
    summary.artifact.gameTitleId,
    comparison.memberIds[0],
  );
  return { view, edit, ...comparison, ...links };
}
