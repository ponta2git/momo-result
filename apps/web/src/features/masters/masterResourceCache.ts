import type { QueryClient } from "@tanstack/react-query";

import { masterQueryKeys } from "@/features/masters/masterQueries";
import { masterKeys } from "@/shared/api/queryKeys";

export type MasterResourceKind = "game-titles" | "map-masters" | "season-masters";

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
  adminQueryKey: readonly unknown[],
  resource: MasterResourceKind,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminQueryKey }),
    queryClient.invalidateQueries({ queryKey: consumerResourceKey(resource) }),
  ]);
}

export async function invalidateMemberAliasCaches(queryClient: QueryClient, authScope: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: masterQueryKeys.memberAliases(authScope) }),
    queryClient.invalidateQueries({ queryKey: masterKeys.memberAliases.all() }),
  ]);
}
