import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  buildMatchAnalysisView,
  matchAnalysisQueryParams,
} from "@/features/matches/detail/matchDetailPresentation";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { readSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysisMatchContextState";
import {
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";

export function useMatchAnalysis(match: MatchDetailResponse | undefined) {
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(match?.gameTitleId));
  const {
    data: statusData,
    isFetching: statusIsFetching,
    isPending: statusIsPending,
    refetch: refetchStatus,
  } = statusQuery;
  const currentArtifactId = statusData?.currentArtifact?.artifactId;
  const contextQueryParams = matchAnalysisQueryParams(match, currentArtifactId);
  const contextQuery = useQuery(seriesAnalysisMatchContextQueryOptions(contextQueryParams));
  const {
    isFetching: contextIsFetching,
    isPending: contextIsPending,
    refetch: refetchContext,
  } = contextQuery;
  const { context: contextData, error: contextError } =
    readSeriesAnalysisMatchContext(contextQuery);
  const refreshResource = useCallback(async () => {
    await refetchContext();
  }, [refetchContext]);
  const refreshPublication = useCallback(async () => {
    const result = await refetchStatus({ cancelRefetch: false });
    return result.data?.currentArtifact?.artifactId;
  }, [refetchStatus]);
  useAnalysisArtifactRecovery({
    artifactId: contextQueryParams?.artifactId,
    error: contextError,
    resourceId: JSON.stringify(["match-context", contextQueryParams]),
    refreshResource,
    refreshPublication,
  });

  return buildMatchAnalysisView({
    match,
    artifactId: currentArtifactId,
    context: contextData,
    calculationStatus: statusData?.calculation?.status,
    statusLoading: statusIsPending || statusIsFetching,
    contextLoading: contextQueryParams !== undefined && (contextIsPending || contextIsFetching),
  });
}
