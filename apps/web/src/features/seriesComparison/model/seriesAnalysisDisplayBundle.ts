import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisMatchContextV2,
  SeriesAnalysisScope,
  SeriesComparisonAggregateV2,
  SeriesComparisonReviewV2,
} from "@/shared/api/seriesAnalysis";

export type SeriesAnalysisDisplayBundle = {
  aggregate: SeriesComparisonAggregateV2;
  matchContext: SeriesAnalysisMatchContextV2 | undefined;
  review: SeriesComparisonReviewV2 | undefined;
};

export type SeriesAnalysisBundleResolution =
  | {
      kind: "excluded";
      status: Exclude<SeriesAnalysisMatchContextV2["inclusion"]["status"], "included">;
    }
  | { kind: "ready"; value: SeriesAnalysisDisplayBundle }
  | { kind: "waiting" };

export function seriesAnalysisFocusExclusionNotice(
  status: "match_changed_since_artifact" | "not_in_artifact" | "not_in_scope",
): string {
  switch (status) {
    case "match_changed_since_artifact":
      return "選択した試合は分析後に更新されたため、強調表示を解除しました。";
    case "not_in_artifact":
      return "選択した試合は現在の分析結果に含まれないため、強調表示を解除しました。";
    case "not_in_scope":
      return "選択した試合は現在の比較条件に含まれないため、強調表示を解除しました。";
  }
}

export function seriesAnalysisScopeSignature(state: SeriesAnalysisUrlState): string {
  return [state.gameTitleId ?? "", state.seasonMasterId ?? "", state.mapMasterId ?? ""].join("|");
}

type ArtifactScopedResource = {
  artifact: { artifactId: string; gameTitleId: string };
  scope: SeriesAnalysisScope;
};

export function matchesSeriesAnalysisResource(
  resource: ArtifactScopedResource | undefined,
  artifactId: string | undefined,
  state: SeriesAnalysisUrlState,
): boolean {
  return Boolean(
    resource &&
    artifactId &&
    state.gameTitleId &&
    resource.artifact.artifactId === artifactId &&
    resource.artifact.gameTitleId === state.gameTitleId &&
    resource.scope.seasonMasterId === state.seasonMasterId &&
    resource.scope.mapMasterId === state.mapMasterId,
  );
}

export function resolveSeriesAnalysisDisplayBundle({
  activeView,
  aggregate,
  artifactId,
  matchContext,
  review,
  state,
}: {
  activeView: SeriesAnalysisUrlState["view"];
  aggregate: SeriesComparisonAggregateV2 | undefined;
  artifactId: string | undefined;
  matchContext: SeriesAnalysisMatchContextV2 | undefined;
  review: SeriesComparisonReviewV2 | undefined;
  state: SeriesAnalysisUrlState;
}): SeriesAnalysisBundleResolution {
  if (!aggregate || !matchesSeriesAnalysisResource(aggregate, artifactId, state)) {
    return { kind: "waiting" };
  }

  const matchingReview = matchesSeriesAnalysisResource(review, artifactId, state)
    ? review
    : undefined;
  if (activeView === "review" && !matchingReview) return { kind: "waiting" };

  if (!state.focusMatchId) {
    return {
      kind: "ready",
      value: { aggregate, matchContext: undefined, review: matchingReview },
    };
  }
  if (
    !matchesSeriesAnalysisResource(matchContext, artifactId, state) ||
    matchContext?.matchId !== state.focusMatchId
  ) {
    return { kind: "waiting" };
  }
  if (matchContext.inclusion.status !== "included") {
    return { kind: "excluded", status: matchContext.inclusion.status };
  }
  if (!matchContext.match) return { kind: "waiting" };
  return {
    kind: "ready",
    value: { aggregate, matchContext, review: matchingReview },
  };
}
