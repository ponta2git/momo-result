import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  cacheCreatedMaster,
  cacheMasterUpdate,
  invalidateMasterResourceCaches,
} from "@/features/masters/masterResourceCache";
import { runIdempotentMutation, runIdempotentOperationAttempt } from "@/shared/api/idempotency";
import type { IdempotencyKeyStore, IdempotencyOperationAttempt } from "@/shared/api/idempotency";
import {
  createGameTitle,
  createMapMaster,
  createSeasonMaster,
  deleteGameTitle,
  deleteMapMaster,
  deleteSeasonMaster,
  updateGameTitle,
  updateMapMaster,
  updateSeasonMaster,
} from "@/shared/api/masters";
import type {
  CreateGameTitleRequest,
  CreateMapMasterRequest,
  CreateSeasonMasterRequest,
  UpdateGameTitleRequest,
  UpdateMapMasterRequest,
  UpdateSeasonMasterRequest,
} from "@/shared/api/masters";
import { masterKeys } from "@/shared/api/queryKeys";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorizationOperations } from "@/shared/auth/useAuthorization";

type CatalogResource = "game-titles" | "map-masters" | "season-masters";

/** Publishes confirmed writes before reconciliation; selection callbacks run at that boundary. */
export function useMasterCatalogWrites(idempotencyKeys: IdempotencyKeyStore) {
  const authorization = useAuthorizationOperations();
  const queryClient = useQueryClient();

  return useMemo(() => {
    const created = async <Item extends { id: string }>(
      resource: CatalogResource,
      queryKey: QueryKey,
      item: Item,
      lease: AuthorizationLease,
      onAccepted?: (id: string) => void,
    ) => {
      if (!authorization.isSameAccount(lease)) return;
      await cacheCreatedMaster(queryClient, queryKey, item, () =>
        authorization.isSameAccount(lease),
      );
      if (authorization.canCommit(lease)) onAccepted?.(item.id);
      await invalidateMasterResourceCaches(queryClient, resource, () =>
        authorization.canCommit(lease),
      );
    };
    const changed = async <Item extends { id: string }>(
      resource: CatalogResource,
      queryKey: QueryKey,
      id: string,
      item: Item | null,
      lease: AuthorizationLease,
      onAccepted?: (id: string) => void,
    ) => {
      if (!authorization.isSameAccount(lease)) return;
      await cacheMasterUpdate(queryClient, queryKey, id, item, () =>
        authorization.isSameAccount(lease),
      );
      if (!authorization.isSameAccount(lease)) return;
      if (authorization.canCommit(lease)) onAccepted?.(id);
      await invalidateMasterResourceCaches(queryClient, resource, () =>
        authorization.canCommit(lease),
      );
    };

    return {
      createGameTitle: async (
        attempt: IdempotencyOperationAttempt,
        request: CreateGameTitleRequest,
        lease: AuthorizationLease,
        onAccepted: (id: string) => void,
      ) => {
        const saved = await runIdempotentOperationAttempt(attempt, (options) =>
          createGameTitle(request, options),
        );
        await created("game-titles", masterKeys.gameTitles.list(), saved, lease, onAccepted);
      },
      createMapMaster: async (
        attempt: IdempotencyOperationAttempt,
        request: CreateMapMasterRequest,
        lease: AuthorizationLease,
      ) => {
        const saved = await runIdempotentOperationAttempt(attempt, (options) =>
          createMapMaster(request, options),
        );
        await created("map-masters", masterKeys.mapMasters.list(request.gameTitleId), saved, lease);
      },
      createSeasonMaster: async (
        attempt: IdempotencyOperationAttempt,
        request: CreateSeasonMasterRequest,
        lease: AuthorizationLease,
      ) => {
        const saved = await runIdempotentOperationAttempt(attempt, (options) =>
          createSeasonMaster(request, options),
        );
        await created(
          "season-masters",
          masterKeys.seasonMasters.list(request.gameTitleId),
          saved,
          lease,
        );
      },
      updateGameTitle: async (
        id: string,
        request: UpdateGameTitleRequest,
        lease: AuthorizationLease,
      ) => {
        const saved = await runIdempotentMutation(
          idempotencyKeys,
          "masters.updateGameTitle",
          { id, request },
          (options) => updateGameTitle(id, request, options),
        );
        await changed("game-titles", masterKeys.gameTitles.all(), id, saved, lease);
      },
      updateMapMaster: async (
        id: string,
        request: UpdateMapMasterRequest,
        lease: AuthorizationLease,
      ) => {
        const saved = await runIdempotentMutation(
          idempotencyKeys,
          "masters.updateMapMaster",
          { id, request },
          (options) => updateMapMaster(id, request, options),
        );
        await changed("map-masters", masterKeys.mapMasters.all(), id, saved, lease);
      },
      updateSeasonMaster: async (
        id: string,
        request: UpdateSeasonMasterRequest,
        lease: AuthorizationLease,
      ) => {
        const saved = await runIdempotentMutation(
          idempotencyKeys,
          "masters.updateSeasonMaster",
          { id, request },
          (options) => updateSeasonMaster(id, request, options),
        );
        await changed("season-masters", masterKeys.seasonMasters.all(), id, saved, lease);
      },
      deleteGameTitle: async (
        id: string,
        lease: AuthorizationLease,
        onAccepted: (id: string) => void,
      ) => {
        await runIdempotentMutation(idempotencyKeys, "masters.deleteGameTitle", { id }, (options) =>
          deleteGameTitle(id, options),
        );
        await changed("game-titles", masterKeys.gameTitles.all(), id, null, lease, onAccepted);
      },
      deleteMapMaster: async (id: string, lease: AuthorizationLease) => {
        await runIdempotentMutation(idempotencyKeys, "masters.deleteMapMaster", { id }, (options) =>
          deleteMapMaster(id, options),
        );
        await changed("map-masters", masterKeys.mapMasters.all(), id, null, lease);
      },
      deleteSeasonMaster: async (id: string, lease: AuthorizationLease) => {
        await runIdempotentMutation(
          idempotencyKeys,
          "masters.deleteSeasonMaster",
          { id },
          (options) => deleteSeasonMaster(id, options),
        );
        await changed("season-masters", masterKeys.seasonMasters.all(), id, null, lease);
      },
    };
  }, [authorization, idempotencyKeys, queryClient]);
}
