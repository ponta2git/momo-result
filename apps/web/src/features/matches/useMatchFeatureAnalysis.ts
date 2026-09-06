import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { buildMatchFeatureBadges } from "@/features/matches/matchDetailViewModel";
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
    isFetching: statusIsFetching,
    isPending: statusIsPending,
    refetch: refetchStatus,
  } = statusQuery;
  const currentArtifactId = statusData?.currentArtifact?.artifactId;
  const contextQueryParams =
    match && currentArtifactId
      ? {
          artifactId: currentArtifactId,
          gameTitleId: match.gameTitleId,
          mapMasterId: match.mapMasterId,
          matchId: match.matchId,
          seasonMasterId: match.seasonMasterId,
        }
      : undefined;
  const contextQuery = useQuery(seriesAnalysisMatchContextQueryOptions(contextQueryParams));
  const {
    data: contextData,
    error: contextError,
    isFetching: contextIsFetching,
    isPending: contextIsPending,
    refetch: refetchContext,
  } = contextQuery;
  const context =
    match &&
    contextData &&
    contextData?.artifact.artifactId === currentArtifactId &&
    contextData.matchId === match.matchId
      ? contextData
      : undefined;
  const requestedArtifactId = contextQueryParams?.artifactId;

  useEffect(() => {
    const artifactId = requestedArtifactId;
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
  }, [contextError, refetchContext, refetchStatus, requestedArtifactId]);

  const performanceContext = matchPerformanceContextFromArtifact(context);
  const badges = buildMatchFeatureBadges({
    features: context?.inclusion.status === "included" ? context.match?.features : undefined,
  });
  const calculationStatus = statusData?.calculation?.status;
  const needsManualRefresh = calculationStatus === "queued" || calculationStatus === "running";
  const loading =
    statusIsPending ||
    statusIsFetching ||
    needsManualRefresh ||
    (contextQueryParams !== undefined && (contextIsPending || contextIsFetching));
  return {
    comparisonContextStatus:
      performanceContext === undefined ? (loading ? "loading" : "unavailable") : "ready",
    badges,
    performanceContext,
  } as const;
}
