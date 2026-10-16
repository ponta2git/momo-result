import { useQuery } from "@tanstack/react-query";

import {
  buildMatchFeatureAnalysis,
  matchFeatureAnalysisQuery,
} from "@/features/matches/matchDetailViewModel";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import { readSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysisMatchContextState";
import {
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";

export function useMatchFeatureAnalysis(match: MatchDetailResponse | undefined) {
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(match?.gameTitleId));
  const {
    data: statusData,
    isFetching: statusIsFetching,
    isPending: statusIsPending,
    refetch: refetchStatus,
  } = statusQuery;
  const currentArtifactId = statusData?.currentArtifact?.artifactId;
  const contextQueryParams = matchFeatureAnalysisQuery(match, currentArtifactId);
  const contextQuery = useQuery(seriesAnalysisMatchContextQueryOptions(contextQueryParams));
  const {
    isFetching: contextIsFetching,
    isPending: contextIsPending,
    refetch: refetchContext,
  } = contextQuery;
  const { context: contextData, error: contextError } =
    readSeriesAnalysisMatchContext(contextQuery);
  useAnalysisArtifactRecovery({
    artifactId: contextQueryParams?.artifactId,
    error: contextError,
    queryKey: seriesAnalysisKeys.matchContext(contextQueryParams),
    refetchArtifact: refetchContext,
    refetchStatus,
  });

  return buildMatchFeatureAnalysis({
    match,
    artifactId: currentArtifactId,
    context: contextData,
    calculationStatus: statusData?.calculation?.status,
    statusLoading: statusIsPending || statusIsFetching,
    contextLoading: contextQueryParams !== undefined && (contextIsPending || contextIsFetching),
  });
}
