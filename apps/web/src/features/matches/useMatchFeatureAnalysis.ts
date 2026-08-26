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
  const currentArtifactId = statusQuery.data?.currentArtifact?.artifactId;
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
  const context = useMemo(() => {
    if (
      !match ||
      !contextQuery.data ||
      contextQuery.data.artifact.artifactId !== currentArtifactId ||
      contextQuery.data.matchId !== match.matchId
    ) {
      return undefined;
    }
    return contextQuery.data;
  }, [contextQuery.data, currentArtifactId, match]);

  useEffect(() => {
    const artifactId = contextQueryParams?.artifactId;
    if (
      !artifactId ||
      handledExpiredArtifacts.current.has(artifactId) ||
      !isAnalysisArtifactExpired(contextQuery.error)
    ) {
      return;
    }
    handledExpiredArtifacts.current.add(artifactId);
    void statusQuery.refetch().then((result) => {
      if (result.data?.currentArtifact?.artifactId === artifactId) {
        return contextQuery.refetch();
      }
      return undefined;
    });
  }, [contextQuery, contextQueryParams?.artifactId, statusQuery]);

  const performanceContext = useMemo(() => matchPerformanceContextFromArtifact(context), [context]);
  const badges = useMemo(
    () => buildMatchFeatureBadges({ features: context?.match?.features }),
    [context?.match?.features],
  );
  const calculationStatus = statusQuery.data?.calculation?.status;
  const loading =
    statusQuery.isPending ||
    statusQuery.isFetching ||
    calculationStatus === "queued" ||
    calculationStatus === "running" ||
    (contextQueryParams !== undefined && (contextQuery.isPending || contextQuery.isFetching));
  const failed =
    context === undefined &&
    (statusQuery.isError || (contextQueryParams !== undefined && contextQuery.isError));
  const retryFeature = useCallback(() => {
    void statusQuery.refetch().then((result) => {
      if (
        contextQueryParams &&
        result.data?.currentArtifact?.artifactId === contextQueryParams.artifactId
      ) {
        return contextQuery.refetch();
      }
      return undefined;
    });
  }, [contextQuery, contextQueryParams, statusQuery]);
  const refreshAnalysis = useCallback(async () => {
    await statusQuery.refetch();
    if (contextQueryParams) await contextQuery.refetch();
  }, [contextQuery, contextQueryParams, statusQuery]);

  return {
    analysisRefreshing: statusQuery.isFetching || contextQuery.isFetching,
    comparisonContextStatus:
      performanceContext === undefined ? (loading ? "loading" : "unavailable") : "ready",
    featureView: buildMatchFeatureView({
      badges,
      failed,
      included: context?.inclusion.status === "included",
      loading,
      matchChanged: context?.inclusion.status === "match_changed_since_artifact",
      onRetry: retryFeature,
      retrying: failed && loading,
    }),
    performanceContext,
    refreshAnalysis,
  } as const;
}
