import { useMemo } from "react";

import { seriesAnalysisQueryFromState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";

/** Builds stable query identities while only enabling the resource required by the active view. */
export function useSeriesAnalysisQueryParams(input: {
  activeView: SeriesAnalysisViewId;
  artifactId: string | undefined;
  deferredState: SeriesAnalysisUrlState;
  state: SeriesAnalysisUrlState;
}) {
  const aggregate = useMemo(
    () =>
      input.activeView === "review"
        ? undefined
        : seriesAnalysisQueryFromState(input.deferredState, input.artifactId),
    [input.activeView, input.artifactId, input.deferredState],
  );
  const review = useMemo(
    () =>
      input.activeView === "review"
        ? seriesAnalysisQueryFromState(input.state, input.artifactId)
        : undefined,
    [input.activeView, input.artifactId, input.state],
  );
  const context = useMemo(
    () => seriesAnalysisQueryFromState(input.state, input.artifactId),
    [input.artifactId, input.state],
  );
  const matchContext = useMemo(
    () =>
      context && input.state.focusMatchId
        ? { ...context, matchId: input.state.focusMatchId }
        : undefined,
    [context, input.state.focusMatchId],
  );

  return { aggregate, matchContext, review };
}
