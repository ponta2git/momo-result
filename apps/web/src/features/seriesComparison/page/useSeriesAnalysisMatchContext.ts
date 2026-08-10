import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import { seriesAnalysisMatchContextQueryOptions } from "@/shared/api/queryOptions";
import type { SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";

export function useSeriesAnalysisMatchContext({
  baseQuery,
  matchId,
  onArtifactExpired,
}: {
  baseQuery: SeriesAnalysisQuery;
  matchId: string | undefined;
  onArtifactExpired: () => void;
}) {
  const queryInput = matchId ? { ...baseQuery, matchId } : undefined;
  const query = useQuery(seriesAnalysisMatchContextQueryOptions(queryInput, Boolean(matchId)));

  useEffect(() => {
    if (isAnalysisArtifactExpired(query.error)) onArtifactExpired();
  }, [onArtifactExpired, query.error]);

  return query;
}
