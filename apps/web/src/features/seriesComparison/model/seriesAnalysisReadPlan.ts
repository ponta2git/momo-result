import { seriesAnalysisQueryFromSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type {
  SeriesAnalysisMatchContextQuery,
  SeriesAnalysisOutlookSummaryQuery,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";
import type { SeriesAnalysisScopeStatus } from "@/shared/api/seriesPlayerRadar";

export type SeriesAnalysisReadPlan =
  | { kind: "waiting" }
  | {
      kind: "unavailable";
      reason: "outlook_map" | Exclude<SeriesAnalysisScopeStatus["state"], "available">;
    }
  | {
      kind: "analysis" | "review";
      query: SeriesAnalysisQuery;
      matchContext: SeriesAnalysisMatchContextQuery | undefined;
    }
  | { kind: "outlook"; query: SeriesAnalysisOutlookSummaryQuery };

/** Resolves view eligibility and the exact publication/scope each read may request. */
export function planSeriesAnalysisRead({
  activeView,
  artifactId,
  deferredSelection,
  scopeState,
  selection,
}: {
  activeView: SeriesAnalysisViewId;
  artifactId: string | undefined;
  deferredSelection: SeriesAnalysisSelection;
  scopeState: SeriesAnalysisScopeStatus["state"] | undefined;
  selection: SeriesAnalysisSelection;
}): SeriesAnalysisReadPlan {
  if (activeView === "outlook" && selection.mapMasterId) {
    return { kind: "unavailable", reason: "outlook_map" };
  }
  if (scopeState === undefined) return { kind: "waiting" };
  const emptyTitleOutlook =
    activeView === "outlook" && scopeState === "empty" && !selection.seasonMasterId;
  if (scopeState !== "available" && !emptyTitleOutlook) {
    return { kind: "unavailable", reason: scopeState };
  }
  const currentSelectionQuery = seriesAnalysisQueryFromSelection(selection, artifactId);
  if (!currentSelectionQuery) return { kind: "waiting" };
  if (activeView === "outlook") return { kind: "outlook", query: currentSelectionQuery };
  const query =
    activeView === "review"
      ? currentSelectionQuery
      : seriesAnalysisQueryFromSelection(deferredSelection, artifactId);
  if (!query) return { kind: "waiting" };
  return {
    kind: activeView === "review" ? "review" : "analysis",
    query,
    matchContext: selection.focusMatchId
      ? { ...currentSelectionQuery, matchId: selection.focusMatchId }
      : undefined,
  };
}
