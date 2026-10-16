import { seriesAnalysisQueryFromState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
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
  deferredState,
  scopeState,
  state,
}: {
  activeView: SeriesAnalysisViewId;
  artifactId: string | undefined;
  deferredState: SeriesAnalysisSelection;
  scopeState: SeriesAnalysisScopeStatus["state"] | undefined;
  state: SeriesAnalysisSelection;
}): SeriesAnalysisReadPlan {
  if (activeView === "outlook" && state.mapMasterId) {
    return { kind: "unavailable", reason: "outlook_map" };
  }
  if (scopeState === undefined) return { kind: "waiting" };
  const emptyTitleOutlook =
    activeView === "outlook" && scopeState === "empty" && !state.seasonMasterId;
  if (scopeState !== "available" && !emptyTitleOutlook) {
    return { kind: "unavailable", reason: scopeState };
  }
  const context = seriesAnalysisQueryFromState(state, artifactId);
  if (!context) return { kind: "waiting" };
  if (activeView === "outlook") return { kind: "outlook", query: context };
  const query =
    activeView === "review" ? context : seriesAnalysisQueryFromState(deferredState, artifactId);
  if (!query) return { kind: "waiting" };
  return {
    kind: activeView === "review" ? "review" : "analysis",
    query,
    matchContext: state.focusMatchId ? { ...context, matchId: state.focusMatchId } : undefined,
  };
}
