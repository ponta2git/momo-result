import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  matchesSeriesAnalysisResource,
  resolveSeriesAnalysisDisplayBundle,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { seriesAnalysisQueryFromState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import type {
  SeriesComparisonAggregateV2,
  SeriesComparisonReviewV2,
} from "@/shared/api/seriesAnalysis";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";

function sameDisplayBundle(
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

function displayBundleWithoutContext(
  activeView: SeriesAnalysisViewId,
  aggregate: SeriesComparisonAggregateV2 | undefined,
  review: SeriesComparisonReviewV2 | undefined,
): SeriesAnalysisDisplayBundle | undefined {
  if (activeView === "review") {
    return review ? { kind: "review", matchContext: undefined, review, view: "review" } : undefined;
  }
  return aggregate
    ? { aggregate, kind: "analysis", matchContext: undefined, view: activeView }
    : undefined;
}

export function useSeriesAnalysisDisplayBundle({
  activeView,
  deferredState,
  state,
}: {
  activeView: SeriesAnalysisViewId;
  deferredState: SeriesAnalysisUrlState;
  state: SeriesAnalysisUrlState;
}) {
  const [displayBundle, setDisplayBundle] = useState<SeriesAnalysisDisplayBundle | undefined>();
  const handledExpiredArtifacts = useRef(new Set<string>());
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(state.gameTitleId));
  const publishedArtifactId = statusQuery.data?.currentArtifact?.artifactId;

  const aggregateQueryParams = useMemo(
    () =>
      activeView === "review"
        ? undefined
        : seriesAnalysisQueryFromState(deferredState, publishedArtifactId),
    [activeView, deferredState, publishedArtifactId],
  );
  const reviewQueryParams = useMemo(
    () =>
      activeView === "review"
        ? seriesAnalysisQueryFromState(state, publishedArtifactId)
        : undefined,
    [activeView, publishedArtifactId, state],
  );
  const aggregateQuery = useQuery(seriesAnalysisAggregateQueryOptions(aggregateQueryParams));
  const reviewQuery = useQuery(seriesAnalysisReviewQueryOptions(reviewQueryParams));

  const candidateAggregate = matchesSeriesAnalysisResource(
    aggregateQuery.data,
    publishedArtifactId,
    state,
  )
    ? aggregateQuery.data
    : undefined;
  const candidateReview = matchesSeriesAnalysisResource(
    reviewQuery.data,
    publishedArtifactId,
    state,
  )
    ? reviewQuery.data
    : undefined;
  const candidateResource = activeView === "review" ? candidateReview : candidateAggregate;
  const candidateArtifactId = candidateResource?.artifact.artifactId;

  const contextQueryParams = useMemo(
    () => seriesAnalysisQueryFromState(state, publishedArtifactId),
    [publishedArtifactId, state],
  );
  const matchContextQueryParams = useMemo(
    () =>
      contextQueryParams && state.focusMatchId
        ? { ...contextQueryParams, matchId: state.focusMatchId }
        : undefined,
    [contextQueryParams, state.focusMatchId],
  );
  const matchContextQuery = useQuery(
    seriesAnalysisMatchContextQueryOptions(matchContextQueryParams),
  );
  const bundleResolution = useMemo(
    () =>
      resolveSeriesAnalysisDisplayBundle({
        activeView,
        aggregate: candidateAggregate,
        artifactId: publishedArtifactId,
        matchContext: matchContextQuery.data,
        review: candidateReview,
        state,
      }),
    [
      activeView,
      candidateAggregate,
      candidateReview,
      matchContextQuery.data,
      publishedArtifactId,
      state,
    ],
  );

  useEffect(() => {
    if (bundleResolution.kind !== "ready") return;
    setDisplayBundle((current) =>
      sameDisplayBundle(current, bundleResolution.value) ? current : bundleResolution.value,
    );
  }, [bundleResolution]);

  useEffect(() => {
    if (
      !candidateResource ||
      bundleResolution.kind !== "waiting" ||
      matchContextQueryParams === undefined ||
      !shouldShowQueryError(matchContextQuery)
    ) {
      return;
    }
    const fallback = displayBundleWithoutContext(activeView, candidateAggregate, candidateReview);
    if (fallback) {
      setDisplayBundle((current) => (sameDisplayBundle(current, fallback) ? current : fallback));
    }
  }, [
    activeView,
    bundleResolution.kind,
    candidateAggregate,
    candidateResource,
    candidateReview,
    matchContextQuery,
    matchContextQueryParams,
  ]);

  const activeQuery = activeView === "review" ? reviewQuery : aggregateQuery;
  const activeQueryParams = activeView === "review" ? reviewQueryParams : aggregateQueryParams;
  const currentDisplayBundle =
    bundleResolution.kind === "ready" ? bundleResolution.value : displayBundle;
  useEffect(() => {
    const artifactId = activeQueryParams?.artifactId;
    if (!artifactId || handledExpiredArtifacts.current.has(artifactId)) return;
    const expired =
      isAnalysisArtifactExpired(activeQuery.error) ||
      isAnalysisArtifactExpired(matchContextQuery.error);
    if (!expired) return;
    handledExpiredArtifacts.current.add(artifactId);
    void statusQuery.refetch().then((result) => {
      if (result.data?.currentArtifact?.artifactId === artifactId) {
        return Promise.all([
          activeQuery.refetch(),
          ...(matchContextQueryParams ? [matchContextQuery.refetch()] : []),
        ]);
      }
      return undefined;
    });
  }, [
    activeQuery,
    activeQueryParams?.artifactId,
    matchContextQuery,
    matchContextQueryParams,
    statusQuery,
  ]);

  return {
    activeQuery,
    activeQueryParams,
    activeResourceMatches: candidateResource !== undefined,
    bundleResolution,
    candidateArtifactId,
    displayBundle: currentDisplayBundle,
    matchContextQuery,
    matchContextQueryParams,
    statusQuery,
  };
}
