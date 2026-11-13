import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  buildMatchAnalysisView,
  matchAnalysisQueryParams,
} from "@/features/matches/detail/matchDetailPresentation";
import { completionCheckOptions } from "@/shared/api/completionCheck";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { SeriesAnalysisStatusResponse } from "@/shared/api/seriesAnalysis";
import { readSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysisMatchContextState";
import {
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";

/**
 * A queued or running calculation is the wait this page shows as 集計待ち. It is named by its
 * request, so moving from queued to running continues the same wait.
 */
function calculationWaitOf(status: SeriesAnalysisStatusResponse) {
  const calculation = status.calculation;
  return calculation?.status === "queued" || calculation?.status === "running"
    ? calculation.requestedAt
    : undefined;
}

export function useMatchAnalysis(match: MatchDetailResponse | undefined) {
  const statusQuery = useQuery({
    ...seriesAnalysisStatusQueryOptions(match?.gameTitleId),
    ...completionCheckOptions(calculationWaitOf),
  });
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
    // Rechecks of a waiting calculation keep showing the wait instead of flashing a load.
    statusLoading:
      statusIsPending ||
      (statusIsFetching &&
        (statusData === undefined || calculationWaitOf(statusData) === undefined)),
    contextLoading: contextQueryParams !== undefined && (contextIsPending || contextIsFetching),
  });
}
