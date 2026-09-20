import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { heldEventKeys, masterKeys, matchKeys, seriesAnalysisKeys } from "@/shared/api/queryKeys";

/** Transfer a confirmed creation to the cache before its optimistic Action ends. */
export async function cacheCreatedMaster<Item extends { id: string }>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  created: Item,
) {
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<{ items?: Item[] }>(queryKey, (response) => {
    if (!response) return response;
    const items = response.items ?? [];
    return {
      ...response,
      items: items.some((item) => item.id === created.id)
        ? items.map((item) => (item.id === created.id ? created : item))
        : [...items, created],
    };
  });
}

/** Reflect the committed result in every loaded scope, even if the following refresh fails. */
export async function cacheMasterUpdate<Item extends { id: string }>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  id: string,
  updated: Item | null,
) {
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueriesData<{ items?: Item[] }>(
    { queryKey },
    (response) =>
      response && {
        ...response,
        items: (response.items ?? []).flatMap((item) =>
          item.id === id ? (updated ? [updated] : []) : [item],
        ),
      },
  );
}

type MasterResourceKind = "game-titles" | "map-masters" | "season-masters";

function consumerResourceKey(resource: MasterResourceKind) {
  if (resource === "game-titles") {
    return masterKeys.gameTitles.all();
  }
  if (resource === "map-masters") {
    return masterKeys.mapMasters.all();
  }
  return masterKeys.seasonMasters.all();
}

export async function invalidateMasterResourceCaches(
  queryClient: QueryClient,
  resource: MasterResourceKind,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: consumerResourceKey(resource) }),
    queryClient.invalidateQueries({ queryKey: matchKeys.collections() }),
    queryClient.invalidateQueries({ queryKey: matchKeys.detailRoot() }),
    queryClient.invalidateQueries({ queryKey: heldEventKeys.all() }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.artifactRoot() }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.options() }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
    queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
  ]);
}

export async function invalidateMemberAliasCaches(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: masterKeys.memberAliases.all() });
}
