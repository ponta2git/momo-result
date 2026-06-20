import type { QueryClient } from "@tanstack/react-query";

import { masterQueryKeys } from "@/features/masters/masterQueries";
import { masterKeys, seriesComparisonKeys } from "@/shared/api/queryKeys";

export type MasterResourceKind = "game-titles" | "map-masters" | "season-masters";

export type MasterResourceInvalidationTarget =
  | { authScope: string; resource: "game-titles" }
  | { authScope: string; gameTitleId: string; resource: "map-masters" }
  | { authScope: string; gameTitleId: string; resource: "season-masters" };

function adminResourceKey(target: MasterResourceInvalidationTarget) {
  if (target.resource === "game-titles") {
    return masterQueryKeys.gameTitles(target.authScope);
  }
  if (target.resource === "map-masters") {
    return masterQueryKeys.mapMasters(target.authScope, target.gameTitleId);
  }
  return masterQueryKeys.seasonMasters(target.authScope, target.gameTitleId);
}

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
  target: MasterResourceInvalidationTarget,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminResourceKey(target) }),
    queryClient.invalidateQueries({ queryKey: consumerResourceKey(target.resource) }),
    queryClient.invalidateQueries({ queryKey: seriesComparisonKeys.all() }),
  ]);
}

export async function invalidateMemberAliasCaches(queryClient: QueryClient, authScope: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: masterQueryKeys.memberAliases(authScope) }),
    queryClient.invalidateQueries({ queryKey: masterKeys.memberAliases.all() }),
  ]);
}
