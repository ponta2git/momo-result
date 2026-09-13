import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent";
import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import type { SeriesAnalysisDrilldownV3, SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";
import { seriesAnalysisDrilldownQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useRetryNotice } from "@/shared/ui/feedback/useRetryNotice";

export type SeriesAnalysisDrilldownResource =
  | { kind: "loading" }
  | { kind: "failed"; pending: boolean; retry: () => void }
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

  const failed = useRetryNotice(
    query.isError,
    query.isFetching,
    JSON.stringify({ ...baseQuery, ...selection }),
  );
  if (failed)
    return { kind: "failed", pending: query.isFetching, retry: () => void query.refetch() };
  if (query.isPending || !query.data) return { kind: "loading" };
  return { data: query.data, kind: "ready" };
}
