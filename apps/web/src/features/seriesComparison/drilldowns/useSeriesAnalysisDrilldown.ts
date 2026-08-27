import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent";
import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import type { SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";
import { seriesAnalysisDrilldownQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";

export function useSeriesAnalysisDrilldown({
  baseQuery,
  onArtifactExpired,
  selection,
}: {
  baseQuery: SeriesAnalysisQuery;
  onArtifactExpired: () => void;
  selection: SeriesAnalysisDrilldownSelection | null;
}) {
  const queryInput = selection ? { ...baseQuery, ...selection } : undefined;
  const query = useQuery(seriesAnalysisDrilldownQueryOptions(queryInput, selection !== null));

  useEffect(() => {
    if (isAnalysisArtifactExpired(query.error)) onArtifactExpired();
  }, [onArtifactExpired, query.error]);

  return query;
}
