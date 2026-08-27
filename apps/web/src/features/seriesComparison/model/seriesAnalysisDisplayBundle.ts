import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisMatchContextV2,
  SeriesAnalysisScope,
  SeriesComparisonAggregateV3,
  SeriesComparisonReviewV3,
} from "@/shared/api/seriesAnalysis";

type SeriesAnalysisAnalysisViewId = Exclude<SeriesAnalysisViewId, "review">;

export type SeriesAnalysisDisplayBundle =
  | {
      aggregate: SeriesComparisonAggregateV3;
      kind: "analysis";
      matchContext: SeriesAnalysisMatchContextV2 | undefined;
      view: SeriesAnalysisAnalysisViewId;
    }
  | {
      kind: "review";
      matchContext: SeriesAnalysisMatchContextV2 | undefined;
      review: SeriesComparisonReviewV3;
      view: "review";
    };

export type SeriesAnalysisBundleResolution =
  | {
      kind: "excluded";
      status: Exclude<SeriesAnalysisMatchContextV2["inclusion"]["status"], "included">;
    }
  | { kind: "ready"; value: SeriesAnalysisDisplayBundle }
  | { kind: "waiting" };

export function displaySeriesAnalysisBundleWithoutContext(
  activeView: SeriesAnalysisViewId,
  aggregate: SeriesComparisonAggregateV3 | undefined,
  review: SeriesComparisonReviewV3 | undefined,
): SeriesAnalysisDisplayBundle | undefined {
  if (activeView === "review") {
    return review ? { kind: "review", matchContext: undefined, review, view: "review" } : undefined;
  }
  return aggregate
    ? { aggregate, kind: "analysis", matchContext: undefined, view: activeView }
    : undefined;
}

export function sameSeriesAnalysisDisplayBundle(
  current: SeriesAnalysisDisplayBundle | undefined,
  next: SeriesAnalysisDisplayBundle,
): boolean {
  if (!current || current.kind !== next.kind || current.view !== next.view) return false;
  if (current.kind === "review" && next.kind === "review") {
    return current.review === next.review && current.matchContext === next.matchContext;
  }
  return (
    current.kind === "analysis" &&
    next.kind === "analysis" &&
    current.aggregate === next.aggregate &&
    current.matchContext === next.matchContext
  );
}

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
    resource.artifact.artifactId === artifactId &&
    matchesSeriesAnalysisScope(resource, state),
  );
}

export function matchesSeriesAnalysisScope(
  resource: ArtifactScopedResource | undefined,
  state: SeriesAnalysisUrlState,
): boolean {
  return Boolean(
    resource &&
    state.gameTitleId &&
    resource.artifact.gameTitleId === state.gameTitleId &&
    resource.scope.seasonMasterId === state.seasonMasterId &&
    resource.scope.mapMasterId === state.mapMasterId,
  );
}

function readyBundle(
  activeView: SeriesAnalysisViewId,
  aggregate: SeriesComparisonAggregateV3 | undefined,
  review: SeriesComparisonReviewV3 | undefined,
  matchContext: SeriesAnalysisMatchContextV2 | undefined,
): SeriesAnalysisBundleResolution {
  if (activeView === "review") {
    return review
      ? {
          kind: "ready",
          value: { kind: "review", matchContext, review, view: "review" },
        }
      : { kind: "waiting" };
  }
  return aggregate
    ? {
        kind: "ready",
        value: { aggregate, kind: "analysis", matchContext, view: activeView },
      }
    : { kind: "waiting" };
}

export function resolveSeriesAnalysisDisplayBundle({
  activeView,
  aggregate,
  artifactId,
  matchContext,
  review,
  state,
}: {
  activeView: SeriesAnalysisViewId;
  aggregate: SeriesComparisonAggregateV3 | undefined;
  artifactId: string | undefined;
  matchContext: SeriesAnalysisMatchContextV2 | undefined;
  review: SeriesComparisonReviewV3 | undefined;
  state: SeriesAnalysisUrlState;
}): SeriesAnalysisBundleResolution {
  const matchingAggregate = matchesSeriesAnalysisResource(aggregate, artifactId, state)
    ? aggregate
    : undefined;
  const matchingReview = matchesSeriesAnalysisResource(review, artifactId, state)
    ? review
    : undefined;
  if (activeView === "review" ? !matchingReview : !matchingAggregate) {
    return { kind: "waiting" };
  }

  if (!state.focusMatchId) {
    return readyBundle(activeView, matchingAggregate, matchingReview, undefined);
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
  return readyBundle(activeView, matchingAggregate, matchingReview, matchContext);
}
