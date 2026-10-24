import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { achievementResourceQueryOptions } from "@/shared/api/achievementQueryOptions";
import type { AchievementResource } from "@/shared/api/achievements";
import { seriesAnalysisStatusQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";

/** Publication selection is title-wide and deliberately independent of comparison scope. */
export function useAchievementPublication(gameTitleId: string | undefined) {
  const queryClient = useQueryClient();
  const status = useQuery(seriesAnalysisStatusQueryOptions(gameTitleId));
  const artifactId = status.data?.currentArtifact?.artifactId;
  const resource = useQuery(achievementResourceQueryOptions(gameTitleId, artifactId));
  const [accepted, setAccepted] = useState<AchievementResource>();
  if (resource.data && !resource.isPlaceholderData && resource.data !== accepted)
    setAccepted(resource.data);
  const data = resource.data ?? (accepted?.gameTitleId === gameTitleId ? accepted : undefined);
  const { refetch: refetchStatus } = status;
  const { refetch: refetchResource } = resource;
  const refreshPublication = useCallback(async () => {
    const result = await refetchStatus({ cancelRefetch: false });
    return result.data?.currentArtifact?.artifactId;
  }, [refetchStatus]);
  const refreshResource = useCallback(async () => {
    await refetchResource();
  }, [refetchResource]);
  useAnalysisArtifactRecovery({
    artifactId,
    error: resource.error,
    resourceId: JSON.stringify(["achievements", gameTitleId, artifactId]),
    refreshPublication,
    refreshResource,
  });
  const refresh = useCallback(async () => {
    const currentArtifactId = await refreshPublication();
    if (gameTitleId && currentArtifactId) {
      await queryClient.fetchQuery({
        ...achievementResourceQueryOptions(gameTitleId, currentArtifactId),
        staleTime: 0,
      });
    }
  }, [gameTitleId, queryClient, refreshPublication]);
  return { status, resource, data, artifactId, refresh };
}
