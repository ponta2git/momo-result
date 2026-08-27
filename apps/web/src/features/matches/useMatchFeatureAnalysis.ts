import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { buildMatchFeatureBadges } from "@/features/matches/matchDetailViewModel";
import { buildMatchFeatureView } from "@/features/matches/matchFeatureViewModel";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import {
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { matchPerformanceContextFromArtifact } from "@/shared/domain/matchPerformanceContext";

export function useMatchFeatureAnalysis(match: MatchDetailResponse | undefined) {
  const handledExpiredArtifacts = useRef(new Set<string>());
  const statusQuery = useQuery(seriesAnalysisStatusQueryOptions(match?.gameTitleId));
  const {
    data: statusData,
    isError: statusIsError,
    isFetching: statusIsFetching,
    isPending: statusIsPending,
    refetch: refetchStatus,
  } = statusQuery;
  const currentArtifactId = statusData?.currentArtifact?.artifactId;
  const contextQueryParams = useMemo(
    () =>
      match && currentArtifactId
        ? {
            artifactId: currentArtifactId,
            gameTitleId: match.gameTitleId,
            mapMasterId: match.mapMasterId,
            matchId: match.matchId,
            seasonMasterId: match.seasonMasterId,
          }
        : undefined,
    [currentArtifactId, match],
  );
  const contextQuery = useQuery(seriesAnalysisMatchContextQueryOptions(contextQueryParams));
  const {
    data: contextData,
    error: contextError,
    isError: contextIsError,
    isFetching: contextIsFetching,
    isPending: contextIsPending,
    refetch: refetchContext,
  } = contextQuery;
  const context = useMemo(() => {
    if (
      !match ||
      !contextData ||
      contextData.artifact.artifactId !== currentArtifactId ||
      contextData.matchId !== match.matchId
    ) {
      return undefined;
    }
    return contextData;
  }, [contextData, currentArtifactId, match]);

  useEffect(() => {
    const artifactId = contextQueryParams?.artifactId;
    if (
      !artifactId ||
      handledExpiredArtifacts.current.has(artifactId) ||
      !isAnalysisArtifactExpired(contextError)
    ) {
      return;
    }
    handledExpiredArtifacts.current.add(artifactId);
    void refetchStatus().then((result) => {
      if (result.data?.currentArtifact?.artifactId === artifactId) {
        return refetchContext();
      }
      return undefined;
    });
  }, [contextError, contextQueryParams?.artifactId, refetchContext, refetchStatus]);

  const performanceContext = useMemo(() => matchPerformanceContextFromArtifact(context), [context]);
  const badges = useMemo(
    () => buildMatchFeatureBadges({ features: context?.match?.features }),
    [context?.match?.features],
  );
  const calculationStatus = statusData?.calculation?.status;
  const needsManualRefresh = calculationStatus === "queued" || calculationStatus === "running";
  const loading =
    statusIsPending ||
    statusIsFetching ||
    needsManualRefresh ||
    (contextQueryParams !== undefined && (contextIsPending || contextIsFetching));
  const failed =
    context === undefined &&
    (statusIsError || (contextQueryParams !== undefined && contextIsError));
  const refreshAnalysis = useCallback(() => {
    void refetchStatus().then((result) => {
      if (
        contextIsError &&
        contextQueryParams &&
        result.data?.currentArtifact?.artifactId === contextQueryParams.artifactId
      ) {
        return refetchContext();
      }
      return undefined;
    });
  }, [contextIsError, contextQueryParams, refetchContext, refetchStatus]);

  return {
    analysisRefreshing: statusIsFetching || contextIsFetching,
    comparisonContextStatus:
      performanceContext === undefined ? (loading ? "loading" : "unavailable") : "ready",
    featureView: buildMatchFeatureView({
      badges,
      failed,
      included: context?.inclusion.status === "included",
      loading,
      matchChanged: context?.inclusion.status === "match_changed_since_artifact",
      onRetry: refreshAnalysis,
      retrying: failed && (statusIsFetching || contextIsFetching),
    }),
    needsManualRefresh,
    performanceContext,
    refreshAnalysis,
  } as const;
}
