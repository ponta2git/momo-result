import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent";
import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import type { SeriesAnalysisDrilldownV3, SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";
import { seriesAnalysisDrilldownQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";

export type SeriesAnalysisDrilldownResource =
  | { kind: "loading" }
  | { kind: "failed"; retry: () => void }
  | { data: SeriesAnalysisDrilldownV3; kind: "ready" };

/** Owns drilldown query lifecycle and exposes only display-relevant resource states. */
export function useSeriesAnalysisDrilldown({
  baseQuery,
  onArtifactExpired,
  selection,
}: {
  baseQuery: SeriesAnalysisQuery;
  onArtifactExpired: () => void;
  selection: SeriesAnalysisDrilldownSelection;
}): SeriesAnalysisDrilldownResource {
  const query = useQuery(seriesAnalysisDrilldownQueryOptions({ ...baseQuery, ...selection }));

  useEffect(() => {
    if (isAnalysisArtifactExpired(query.error)) onArtifactExpired();
  }, [onArtifactExpired, query.error]);

  if (query.isPending) return { kind: "loading" };
  if (query.isError) return { kind: "failed", retry: () => void query.refetch() };
  return { data: query.data, kind: "ready" };
}
