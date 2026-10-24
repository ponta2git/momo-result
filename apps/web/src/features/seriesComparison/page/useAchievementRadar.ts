import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { achievementPageHref } from "@/shared/achievements/achievementPresentation";
import { achievementResourceQueryOptions } from "@/shared/api/achievementQueryOptions";
import type { AchievementResource } from "@/shared/api/achievements";
import { seriesAnalysisStatusQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";
import type { PlayerRadarDisplay } from "@/shared/seriesAnalysis/playerRadarPresentation";

type AcceptedRadar = {
  identity: string;
  artifactId: string | undefined;
  summary: AchievementResource["summaries"][number];
  radar: PlayerRadarDisplay | undefined;
};

export function useAchievementRadar(
  gameTitleId: string,
  artifactId: string | undefined,
  mapMasterId: string | undefined,
  seasonMasterId: string | undefined,
  radar: PlayerRadarDisplay | undefined,
) {
  const queryClient = useQueryClient();
  const query = useQuery(achievementResourceQueryOptions(gameTitleId, artifactId));
  const refreshPublication = useCallback(async () => {
    const status = await queryClient.fetchQuery({
      ...seriesAnalysisStatusQueryOptions(gameTitleId),
      staleTime: 0,
    });
    return status.currentArtifact?.artifactId;
  }, [gameTitleId, queryClient]);
  const { refetch } = query;
  const refreshResource = useCallback(async () => {
    await refetch();
  }, [refetch]);
  useAnalysisArtifactRecovery({
    artifactId,
    error: query.error,
    resourceId: JSON.stringify(["achievement-radar", gameTitleId, artifactId]),
    refreshPublication,
    refreshResource,
  });
  const data =
    query.data?.gameTitleId === gameTitleId && query.data.artifact.artifactId === artifactId
      ? query.data
      : undefined;
  const summary = data?.summaries.find(
    (value) => (value.mapMasterId ?? "") === (mapMasterId ?? ""),
  );
  const identity = JSON.stringify([gameTitleId, mapMasterId, seasonMasterId]);
  const [accepted, setAccepted] = useState<AcceptedRadar>();
  if (
    summary &&
    (accepted?.identity !== identity ||
      accepted.artifactId !== artifactId ||
      accepted.summary !== summary ||
      accepted.radar !== radar)
  )
    setAccepted({ identity, artifactId, summary, radar });
  const previous = accepted?.identity === identity ? accepted : undefined;
  const displaySummary = summary ?? previous?.summary;
  const displayRadar = summary ? radar : (previous?.radar ?? radar);
  const retained = !summary && previous !== undefined;
  const players = displaySummary?.players.map((player) => ({
    ...player,
    totalPoints: displaySummary.totalPoints,
  }));
  const href = `${achievementPageHref(gameTitleId)}${mapMasterId ? `&mapMasterId=${encodeURIComponent(mapMasterId)}` : ""}`;
  return { query, summary, players, href, radar: displayRadar, retained };
}
