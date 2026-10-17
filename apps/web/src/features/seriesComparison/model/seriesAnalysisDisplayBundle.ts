import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type {
  SeriesAnalysisMatchContextV3,
  SeriesAnalysisScope,
  SeriesComparisonAggregate,
  SeriesComparisonReviewV3,
  SeriesAnalysisOutlookSummary,
} from "@/shared/api/seriesAnalysis";

type SeriesAnalysisAggregateViewId = Exclude<SeriesAnalysisViewId, "review" | "outlook">;

export type SeriesAnalysisDisplayBundle =
  | {
      aggregate: SeriesComparisonAggregate;
      kind: "analysis";
      matchContext: SeriesAnalysisMatchContextV3 | undefined;
      view: SeriesAnalysisAggregateViewId;
    }
  | {
      kind: "review";
      matchContext: SeriesAnalysisMatchContextV3 | undefined;
      review: SeriesComparisonReviewV3;
      view: "review";
    }
  | {
      kind: "outlook";
      outlook: SeriesAnalysisOutlookSummary;
      matchContext: undefined;
      view: "outlook";
    };

export function seriesAnalysisBundleResource(
  bundle: SeriesAnalysisDisplayBundle,
): SeriesComparisonAggregate | SeriesComparisonReviewV3 | SeriesAnalysisOutlookSummary;
export function seriesAnalysisBundleResource(
  bundle: SeriesAnalysisDisplayBundle | undefined,
): SeriesComparisonAggregate | SeriesComparisonReviewV3 | SeriesAnalysisOutlookSummary | undefined;
export function seriesAnalysisBundleResource(bundle: SeriesAnalysisDisplayBundle | undefined) {
  return bundle?.kind === "review"
    ? bundle.review
    : bundle?.kind === "outlook"
      ? bundle.outlook
      : bundle?.aggregate;
}

/** A retained publication supplies its own scope, even while controls request another one. */
export function seriesAnalysisDisplayedSelection(
  bundle: SeriesAnalysisDisplayBundle,
  selection: SeriesAnalysisSelection,
): SeriesAnalysisSelection {
  const resource = seriesAnalysisBundleResource(bundle);
  return {
    ...selection,
    gameTitleId: resource.artifact.gameTitleId,
    mapMasterId: "mapMasterId" in resource.scope ? resource.scope.mapMasterId : undefined,
    seasonMasterId: "seasonMasterId" in resource.scope ? resource.scope.seasonMasterId : undefined,
  };
}

export type SeriesAnalysisBundleResolution =
  | {
      kind: "excluded";
      status: Exclude<SeriesAnalysisMatchContextV3["inclusion"]["status"], "included">;
    }
  | { kind: "ready"; value: SeriesAnalysisDisplayBundle }
  | { kind: "waiting" };

/** Builds a view bundle without deciding whether a new publication may be adopted. */
function buildSeriesAnalysisBundleWithoutContext(
  activeView: SeriesAnalysisViewId,
  aggregate: SeriesComparisonAggregate | undefined,
  review: SeriesComparisonReviewV3 | undefined,
  outlook?: SeriesAnalysisOutlookSummary | undefined,
): SeriesAnalysisDisplayBundle | undefined {
  if (activeView === "outlook") {
    return outlook
      ? { kind: "outlook", outlook, matchContext: undefined, view: "outlook" }
      : undefined;
  }
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
  if (current.kind === "outlook" && next.kind === "outlook")
    return current.outlook === next.outlook;
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

export function seriesAnalysisScopeSignature(selection: SeriesAnalysisSelection): string {
  return [
    selection.gameTitleId ?? "",
    selection.seasonMasterId ?? "",
    selection.mapMasterId ?? "",
  ].join("|");
}

type ArtifactScopedResource = {
  artifact: { artifactId: string; gameTitleId: string };
  scope: SeriesAnalysisScope | SeriesAnalysisMatchContextV3["scope"];
};

function scopeSeasonMasterId(scope: ArtifactScopedResource["scope"]): string | undefined {
  return "seasonMasterId" in scope ? scope.seasonMasterId : undefined;
}

function scopeMapMasterId(scope: ArtifactScopedResource["scope"]): string | undefined {
  return "mapMasterId" in scope ? scope.mapMasterId : undefined;
}

export function matchesSeriesAnalysisResource(
  resource: ArtifactScopedResource | undefined,
  artifactId: string | undefined,
  selection: SeriesAnalysisSelection,
): boolean {
  return Boolean(
    resource &&
    artifactId &&
    resource.artifact.artifactId === artifactId &&
    matchesSeriesAnalysisScope(resource, selection),
  );
}

export function matchesSeriesAnalysisScope(
  resource: ArtifactScopedResource | undefined,
  selection: SeriesAnalysisSelection,
): boolean {
  return Boolean(
    resource &&
    selection.gameTitleId &&
    resource.artifact.gameTitleId === selection.gameTitleId &&
    scopeSeasonMasterId(resource.scope) === selection.seasonMasterId &&
    scopeMapMasterId(resource.scope) === selection.mapMasterId,
  );
}

/** Verifies the selected candidate before resolving its independently loaded match context. */
export function prepareSeriesAnalysisDisplayBundle({
  activeView,
  aggregate,
  artifactId,
  matchContext,
  review,
  outlook,
  selection,
}: {
  activeView: SeriesAnalysisViewId;
  aggregate: SeriesComparisonAggregate | undefined;
  artifactId: string | undefined;
  matchContext: SeriesAnalysisMatchContextV3 | undefined;
  review: SeriesComparisonReviewV3 | undefined;
  outlook?: SeriesAnalysisOutlookSummary | undefined;
  selection: SeriesAnalysisSelection;
}): {
  candidate: SeriesAnalysisDisplayBundle | undefined;
  resolution: SeriesAnalysisBundleResolution;
} {
  const receivedBundle = buildSeriesAnalysisBundleWithoutContext(
    activeView,
    aggregate,
    review,
    outlook,
  );
  const candidate = matchesSeriesAnalysisResource(
    seriesAnalysisBundleResource(receivedBundle),
    artifactId,
    selection,
  )
    ? receivedBundle
    : undefined;
  // Context failure can still expose this verified candidate without selected-match markers.
  return {
    candidate,
    resolution: resolveSeriesAnalysisBundleContext(candidate, matchContext, selection),
  };
}

function resolveSeriesAnalysisBundleContext(
  candidate: SeriesAnalysisDisplayBundle | undefined,
  matchContext: SeriesAnalysisMatchContextV3 | undefined,
  selection: SeriesAnalysisSelection,
): SeriesAnalysisBundleResolution {
  if (!candidate) return { kind: "waiting" };
  if (candidate.kind === "outlook" || !selection.focusMatchId)
    return { kind: "ready", value: candidate };
  const artifactId = seriesAnalysisBundleResource(candidate).artifact.artifactId;
  if (
    !matchesSeriesAnalysisResource(matchContext, artifactId, selection) ||
    matchContext?.matchId !== selection.focusMatchId
  ) {
    return { kind: "waiting" };
  }
  if (matchContext.inclusion.status !== "included") {
    return { kind: "excluded", status: matchContext.inclusion.status };
  }
  if (!matchContext.match) return { kind: "waiting" };
  return { kind: "ready", value: { ...candidate, matchContext } };
}

type SeriesAnalysisDisplayAdoption =
  | { kind: "outlook-deferred"; bundle: Extract<SeriesAnalysisDisplayBundle, { kind: "outlook" }> }
  | { kind: "accepted"; bundle: SeriesAnalysisDisplayBundle | undefined };

/** Chooses one coherent snapshot; a gesture holds its summary and scope together. */
export function retainSeriesAnalysisDisplayBundle({
  activeView,
  candidate,
  deferOutlookAdoption,
  failed,
  matchContextFailed,
  matchContextRequested,
  matchContextUnavailable,
  previous,
  resolution,
  selection,
}: {
  activeView: SeriesAnalysisViewId;
  candidate: SeriesAnalysisDisplayBundle | undefined;
  deferOutlookAdoption: boolean;
  failed: boolean;
  matchContextFailed: boolean;
  matchContextRequested: boolean;
  matchContextUnavailable: boolean;
  previous: SeriesAnalysisDisplayBundle | undefined;
  resolution: SeriesAnalysisBundleResolution;
  selection: SeriesAnalysisSelection;
}): SeriesAnalysisDisplayAdoption {
  const previousMatchesScope = matchesSeriesAnalysisScope(
    seriesAnalysisBundleResource(previous),
    selection,
  );
  if (
    activeView === "outlook" &&
    deferOutlookAdoption &&
    previous?.kind === "outlook" &&
    previousMatchesScope
  ) {
    return { kind: "outlook-deferred", bundle: previous };
  }
  const resolvedBundle =
    resolution.kind === "ready"
      ? resolution.value
      : resolution.kind === "waiting" &&
          matchContextRequested &&
          (matchContextFailed || matchContextUnavailable)
        ? candidate
        : undefined;
  // Definitive context invalidation also applies when its replacement aggregate is missing.
  if (resolvedBundle) return { kind: "accepted", bundle: resolvedBundle };
  if (matchContextUnavailable && previous?.matchContext) {
    return { kind: "accepted", bundle: { ...previous, matchContext: undefined } };
  }
  const retainedBundle =
    failed && previousMatchesScope
      ? buildSeriesAnalysisBundleWithoutContext(
          activeView,
          previous?.kind === "analysis" ? previous.aggregate : undefined,
          previous?.kind === "review" ? previous.review : undefined,
          previous?.kind === "outlook" ? previous.outlook : undefined,
        )
      : undefined;
  if (retainedBundle && retainedBundle.kind !== "outlook" && !matchContextUnavailable) {
    retainedBundle.matchContext =
      previous?.matchContext?.matchId === selection.focusMatchId
        ? previous?.matchContext
        : undefined;
  }
  return { kind: "accepted", bundle: retainedBundle ?? previous };
}

/** Retained data stays visible while changing targets, with actions fenced by identity. */
export function resolveSeriesAnalysisVisibleBundle({
  activeView,
  artifactId,
  bundle,
  bundleFetching,
  displaySettling,
  outlookAdoptionDeferred,
  resolution,
  scopeAvailable,
  scopePending,
  scopeSettling,
  selection,
}: {
  activeView: SeriesAnalysisViewId;
  artifactId: string | undefined;
  bundle: SeriesAnalysisDisplayBundle | undefined;
  bundleFetching: boolean;
  displaySettling: boolean;
  outlookAdoptionDeferred: boolean;
  resolution: SeriesAnalysisBundleResolution;
  scopeAvailable: boolean;
  scopePending: boolean;
  scopeSettling: boolean;
  selection: SeriesAnalysisSelection;
}) {
  const purpose =
    activeView === "outlook" ? "outlook" : activeView === "review" ? "review" : "analysis";
  const resource = seriesAnalysisBundleResource(bundle);
  const matchesScope = matchesSeriesAnalysisScope(resource, selection);
  const changing = bundleFetching || scopeSettling || displaySettling;
  const visibleBundle =
    (outlookAdoptionDeferred || scopeAvailable || scopePending) &&
    ((bundle?.kind === purpose && matchesScope) || scopePending || changing)
      ? bundle
      : undefined;
  const shielded =
    !(activeView === "outlook" && visibleBundle?.kind === "outlook" && matchesScope) &&
    visibleBundle !== undefined &&
    (scopePending ||
      ((!matchesSeriesAnalysisResource(resource, artifactId, selection) ||
        visibleBundle.view !== activeView ||
        (visibleBundle.matchContext !== undefined &&
          visibleBundle.matchContext.matchId !== selection.focusMatchId)) &&
        changing) ||
      (resolution.kind === "waiting" && bundleFetching));
  return { bundle: visibleBundle, shielded };
}
