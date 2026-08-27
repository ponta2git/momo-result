import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import {
  getSeriesAnalysisAdminOverview,
  getSeriesAnalysisAggregate,
  getSeriesAnalysisDrilldown,
  getSeriesAnalysisMatchContext,
  getSeriesAnalysisOptions,
  getSeriesAnalysisReview,
  getSeriesAnalysisStatus,
} from "@/shared/api/seriesAnalysis";
import type {
  SeriesAnalysisDrilldownQuery,
  SeriesAnalysisMatchContextQuery,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";

// Artifact IDs address immutable payloads; explicit refresh still bypasses staleTime.
const immutableArtifactStaleTime = Number.POSITIVE_INFINITY;

export function seriesAnalysisOptionsQueryOptions() {
  return queryOptions({
    queryKey: seriesAnalysisKeys.options(),
    queryFn: ({ signal }) => getSeriesAnalysisOptions({ signal }),
  });
}

export function seriesAnalysisStatusQueryOptions(gameTitleId: string | undefined) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.status(gameTitleId),
    queryFn: ({ signal }) => {
      if (!gameTitleId) throw new Error("series analysis status query is not ready");
      return getSeriesAnalysisStatus(gameTitleId, { signal });
    },
    enabled: Boolean(gameTitleId),
  });
}

export function seriesAnalysisAggregateQueryOptions(query: SeriesAnalysisQuery | undefined) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.aggregate(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis aggregate query is not ready");
      return getSeriesAnalysisAggregate(query, { signal });
    },
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: immutableArtifactStaleTime,
  });
}

export function seriesAnalysisReviewQueryOptions(
  query: SeriesAnalysisQuery | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.review(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis review query is not ready");
      return getSeriesAnalysisReview(query, { signal });
    },
    enabled: enabled && query !== undefined,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: immutableArtifactStaleTime,
  });
}

export function seriesAnalysisDrilldownQueryOptions(
  query: SeriesAnalysisDrilldownQuery | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.drilldown(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis drilldown query is not ready");
      return getSeriesAnalysisDrilldown(query, { signal });
    },
    enabled: enabled && query !== undefined,
    retry: false,
    staleTime: immutableArtifactStaleTime,
  });
}

export function seriesAnalysisMatchContextQueryOptions(
  query: SeriesAnalysisMatchContextQuery | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.matchContext(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis match context query is not ready");
      return getSeriesAnalysisMatchContext(query, { signal });
    },
    enabled: enabled && query !== undefined,
    retry: false,
    staleTime: immutableArtifactStaleTime,
  });
}

export function seriesAnalysisAdminOverviewQueryOptions(
  gameTitleId: string | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.adminOverview(gameTitleId),
    queryFn: ({ signal }) => getSeriesAnalysisAdminOverview(gameTitleId, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    // The default response is seeded under its canonical title key before URL normalization.
    // Keep that handoff fresh so canonicalizing the route does not issue the same request twice.
    staleTime: 10_000,
  });
}
