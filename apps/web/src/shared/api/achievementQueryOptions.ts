import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getAchievementCatalog, getAchievements } from "@/shared/api/achievements";
import { matchKeys, seriesAnalysisKeys } from "@/shared/api/queryKeys";

export const achievementKeys = {
  all: () => ["achievements"] as const,
  catalogs: () => ["achievements", "catalog"] as const,
  catalog: (gameTitleId: string | undefined) => ["achievements", "catalog", gameTitleId] as const,
  publications: () => ["achievements", "published"] as const,
  publication: (gameTitleId: string | undefined, artifactId: string | undefined) =>
    ["achievements", "published", gameTitleId, artifactId] as const,
};

export function achievementCatalogQueryOptions(gameTitleId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: achievementKeys.catalog(gameTitleId),
    queryFn: ({ signal }) => {
      if (!gameTitleId) throw new Error("Achievement catalog is not ready");
      return getAchievementCatalog(gameTitleId, { signal });
    },
    enabled: enabled && Boolean(gameTitleId),
  });
}

export function achievementResourceQueryOptions(
  gameTitleId: string | undefined,
  artifactId: string | undefined,
) {
  return queryOptions({
    queryKey: achievementKeys.publication(gameTitleId, artifactId),
    queryFn: ({ signal }) => {
      if (!gameTitleId || !artifactId) throw new Error("Achievement publication is not ready");
      return getAchievements(gameTitleId, artifactId, { signal });
    },
    enabled: Boolean(gameTitleId && artifactId),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Invalidate metadata and publication status without assembling unpublished scores in the client. */
export async function invalidateAchievementReads(queryClient: QueryClient, gameTitleId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: achievementKeys.catalog(gameTitleId) }),
    queryClient.invalidateQueries({ queryKey: achievementKeys.publications() }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.status(gameTitleId) }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
    queryClient.invalidateQueries({
      queryKey: matchKeys.detailRoot(),
      predicate: ({ queryKey }) => queryKey.at(-1) === "read-result",
    }),
  ]);
}
