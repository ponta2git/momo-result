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
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisReviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/queryOptions";

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
    () => seriesAnalysisQueryFromState(deferredState, publishedArtifactId),
    [deferredState, publishedArtifactId],
  );
  const aggregateQuery = useQuery(seriesAnalysisAggregateQueryOptions(aggregateQueryParams));
  const candidateAggregate = matchesSeriesAnalysisResource(
    aggregateQuery.data,
    publishedArtifactId,
    state,
  )
    ? aggregateQuery.data
    : undefined;
  const candidateArtifactId = candidateAggregate?.artifact.artifactId;
  const reviewQueryParams = useMemo(
    () => seriesAnalysisQueryFromState(state, candidateArtifactId),
    [candidateArtifactId, state],
  );
  const reviewEnabled = reviewQueryParams !== undefined && activeView === "review";
  const reviewQuery = useQuery(seriesAnalysisReviewQueryOptions(reviewQueryParams, reviewEnabled));
  const matchContextQueryParams = useMemo(
    () =>
      reviewQueryParams && state.focusMatchId
        ? { ...reviewQueryParams, matchId: state.focusMatchId }
        : undefined,
    [reviewQueryParams, state.focusMatchId],
  );
  const matchContextQuery = useQuery(
    seriesAnalysisMatchContextQueryOptions(matchContextQueryParams),
  );
  const bundleResolution = useMemo(
    () =>
      resolveSeriesAnalysisDisplayBundle({
        activeView,
        aggregate: candidateAggregate,
        artifactId: candidateArtifactId,
        matchContext: matchContextQuery.data,
        review: reviewQuery.data,
        state,
      }),
    [
      activeView,
      candidateAggregate,
      candidateArtifactId,
      matchContextQuery.data,
      reviewQuery.data,
      state,
    ],
  );

  useEffect(() => {
    if (bundleResolution.kind !== "ready") return;
    setDisplayBundle((current) => {
      const next = bundleResolution.value;
      return current?.aggregate === next.aggregate &&
        current.review === next.review &&
        current.matchContext === next.matchContext
        ? current
        : next;
    });
  }, [bundleResolution]);

  useEffect(() => {
    if (displayBundle || !candidateAggregate || bundleResolution.kind !== "waiting") return;
    const reviewFailed = reviewEnabled && shouldShowQueryError(reviewQuery);
    const contextFailed =
      matchContextQueryParams !== undefined && shouldShowQueryError(matchContextQuery);
    if (reviewFailed || contextFailed) {
      setDisplayBundle({
        aggregate: candidateAggregate,
        matchContext: undefined,
        review: undefined,
      });
    }
  }, [
    bundleResolution.kind,
    candidateAggregate,
    displayBundle,
    matchContextQuery,
    matchContextQueryParams,
    reviewEnabled,
    reviewQuery,
  ]);

  useEffect(() => {
    const artifactId = aggregateQueryParams?.artifactId;
    if (!artifactId || handledExpiredArtifacts.current.has(artifactId)) return;
    const expired =
      isAnalysisArtifactExpired(aggregateQuery.error) ||
      isAnalysisArtifactExpired(reviewQuery.error) ||
      isAnalysisArtifactExpired(matchContextQuery.error);
    if (!expired) return;
    handledExpiredArtifacts.current.add(artifactId);
    void statusQuery.refetch().then((result) => {
      if (result.data?.currentArtifact?.artifactId === artifactId) {
        return Promise.all([
          aggregateQuery.refetch(),
          ...(reviewEnabled ? [reviewQuery.refetch()] : []),
          ...(matchContextQueryParams ? [matchContextQuery.refetch()] : []),
        ]);
      }
      return undefined;
    });
  }, [
    aggregateQuery,
    aggregateQueryParams?.artifactId,
    matchContextQuery,
    matchContextQueryParams,
    reviewEnabled,
    reviewQuery,
    statusQuery,
  ]);

  return {
    aggregateQuery,
    aggregateQueryParams,
    bundleResolution,
    candidateAggregate,
    candidateArtifactId,
    displayBundle,
    matchContextQuery,
    matchContextQueryParams,
    reviewArtifactMatches: matchesSeriesAnalysisResource(
      reviewQuery.data,
      candidateArtifactId,
      state,
    ),
    reviewEnabled,
    reviewQuery,
    statusQuery,
  };
}
