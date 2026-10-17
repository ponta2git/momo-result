import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  normalizeGameTitleEdit,
  normalizeMasterNameEdit,
} from "@/features/masters/catalog/catalogForms";
import {
  cacheMasterUpdate,
  invalidateMasterResourceCaches,
} from "@/features/masters/masterResourceCache";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import {
  deleteGameTitle,
  deleteMapMaster,
  deleteSeasonMaster,
  updateGameTitle as updateGameTitleResource,
  updateMapMaster as updateMapMasterResource,
  updateSeasonMaster as updateSeasonMasterResource,
} from "@/shared/api/masters";
import { masterKeys } from "@/shared/api/queryKeys";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import type { ManagementPermission } from "@/shared/auth/permissions";
import { useAuthorizationOperations } from "@/shared/auth/useAuthorization";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useMasterCatalogMutations(input: {
  onFeedback: (kind: string, scope: string, message: string) => void;
  idempotencyKeys: IdempotencyKeyStore;
  queryClient: QueryClient;
  selectedGameTitleId: string;
  onGameTitleDeleted: (id: string) => void;
}) {
  const authorization = useAuthorizationOperations();
  const { onFeedback, idempotencyKeys, queryClient, selectedGameTitleId, onGameTitleDeleted } =
    input;
  const [pendingLeases, setPendingLeases] = useState<AuthorizationLease[]>([]);
  const [operationError, setOperationError] = useState<string>();

  const trackMutation = async <Result>(
    permission: ManagementPermission,
    action: (lease: AuthorizationLease) => Promise<Result>,
  ) => {
    const lease = authorization.begin(permission);
    if (!lease) throw new DOMException("権限を確認できません", "AbortError");
    setPendingLeases((pending) => [...pending, lease]);
    try {
      return await action(lease);
    } catch (error) {
      authorization.reportError(error, lease);
      throw error;
    } finally {
      setPendingLeases((pending) => pending.filter((attempt) => attempt !== lease));
    }
  };

  const deleteWithDialogFeedback = useCallback(
    async (action: () => Promise<unknown>) => {
      setOperationError(undefined);
      await action();
    },
    [setOperationError],
  );

  const updateGameTitle = useCallback(
    async (
      lease: AuthorizationLease,
      id: string,
      request: { name: string; layoutFamily: string },
    ) => {
      onFeedback("gameTitle", "", "");
      setOperationError(undefined);
      const parsed = normalizeGameTitleEdit(request);
      if (parsed.kind === "invalid") {
        setOperationError(parsed.error);
        return;
      }
      const normalizedRequest = parsed.request;
      const updated = await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateGameTitle",
        { id, request: normalizedRequest },
        (options) => updateGameTitleResource(id, normalizedRequest, options),
      );
      if (!authorization.isSameAccount(lease)) return;
      await cacheMasterUpdate(queryClient, masterKeys.gameTitles.all(), id, updated, () =>
        authorization.isSameAccount(lease),
      );
      if (!authorization.isSameAccount(lease)) return;
      await invalidateMasterResourceCaches(queryClient, "game-titles", () =>
        authorization.canCommit(lease),
      );
      if (authorization.isCurrent(lease)) onFeedback("gameTitle", "", "作品を保存しました");
    },
    [authorization, onFeedback, idempotencyKeys, queryClient, setOperationError],
  );

  const updateMapMaster = useCallback(
    async (lease: AuthorizationLease, id: string, request: { name: string }) => {
      onFeedback("map", selectedGameTitleId, "");
      setOperationError(undefined);
      const normalizedRequest = normalizeMasterNameEdit(request);
      const updated = await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateMapMaster",
        { id, request: normalizedRequest },
        (options) => updateMapMasterResource(id, normalizedRequest, options),
      );
      if (!authorization.isSameAccount(lease)) return;
      await cacheMasterUpdate(queryClient, masterKeys.mapMasters.all(), id, updated, () =>
        authorization.isSameAccount(lease),
      );
      if (!authorization.isSameAccount(lease)) return;
      await invalidateMasterResourceCaches(queryClient, "map-masters", () =>
        authorization.canCommit(lease),
      );
      if (authorization.isCurrent(lease))
        onFeedback("map", selectedGameTitleId, "マップを保存しました");
    },
    [authorization, onFeedback, idempotencyKeys, queryClient, selectedGameTitleId],
  );

  const updateSeasonMaster = useCallback(
    async (lease: AuthorizationLease, id: string, request: { name: string }) => {
      onFeedback("season", selectedGameTitleId, "");
      setOperationError(undefined);
      const normalizedRequest = normalizeMasterNameEdit(request);
      const updated = await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateSeasonMaster",
        { id, request: normalizedRequest },
        (options) => updateSeasonMasterResource(id, normalizedRequest, options),
      );
      if (!authorization.isSameAccount(lease)) return;
      await cacheMasterUpdate(queryClient, masterKeys.seasonMasters.all(), id, updated, () =>
        authorization.isSameAccount(lease),
      );
      if (!authorization.isSameAccount(lease)) return;
      await invalidateMasterResourceCaches(queryClient, "season-masters", () =>
        authorization.canCommit(lease),
      );
      if (authorization.isCurrent(lease))
        onFeedback("season", selectedGameTitleId, "シーズンを保存しました");
    },
    [authorization, onFeedback, idempotencyKeys, queryClient, selectedGameTitleId],
  );

  return {
    operationError,
    deleteGameTitle: (id: string) =>
      trackMutation("admin", (lease) =>
        deleteWithDialogFeedback(async () => {
          onFeedback("gameTitle", "", "");
          await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteGameTitle",
            { id },
            (options) => deleteGameTitle(id, options),
          );
          if (!authorization.isSameAccount(lease)) return;
          await cacheMasterUpdate(queryClient, masterKeys.gameTitles.all(), id, null, () =>
            authorization.isSameAccount(lease),
          );
          if (!authorization.isSameAccount(lease)) return;
          if (authorization.canCommit(lease)) onGameTitleDeleted(id);
          await invalidateMasterResourceCaches(queryClient, "game-titles", () =>
            authorization.canCommit(lease),
          );
          if (authorization.canCommit(lease))
            showToast({ title: "作品を削除しました", tone: "success" });
        }),
      ),
    deleteMapMaster: (id: string) =>
      trackMutation("operations", (lease) =>
        deleteWithDialogFeedback(async () => {
          onFeedback("map", selectedGameTitleId, "");
          await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteMapMaster",
            { id },
            (options) => deleteMapMaster(id, options),
          );
          if (!authorization.isSameAccount(lease)) return;
          await cacheMasterUpdate(queryClient, masterKeys.mapMasters.all(), id, null, () =>
            authorization.isSameAccount(lease),
          );
          if (!authorization.isSameAccount(lease)) return;
          await invalidateMasterResourceCaches(queryClient, "map-masters", () =>
            authorization.canCommit(lease),
          );
          if (authorization.canCommit(lease))
            showToast({ title: "マップを削除しました", tone: "success" });
        }),
      ),
    deleteSeasonMaster: (id: string) =>
      trackMutation("operations", (lease) =>
        deleteWithDialogFeedback(async () => {
          onFeedback("season", selectedGameTitleId, "");
          await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteSeasonMaster",
            { id },
            (options) => deleteSeasonMaster(id, options),
          );
          if (!authorization.isSameAccount(lease)) return;
          await cacheMasterUpdate(queryClient, masterKeys.seasonMasters.all(), id, null, () =>
            authorization.isSameAccount(lease),
          );
          if (!authorization.isSameAccount(lease)) return;
          await invalidateMasterResourceCaches(queryClient, "season-masters", () =>
            authorization.canCommit(lease),
          );
          if (authorization.canCommit(lease))
            showToast({ title: "シーズンを削除しました", tone: "success" });
        }),
      ),
    pending: pendingLeases.some(authorization.isCurrent),
    updateGameTitle: (id: string, request: { name: string; layoutFamily: string }) =>
      trackMutation("admin", (lease) => updateGameTitle(lease, id, request)),
    updateMapMaster: (id: string, request: { name: string }) =>
      trackMutation("operations", (lease) => updateMapMaster(lease, id, request)),
    updateSeasonMaster: (id: string, request: { name: string }) =>
      trackMutation("operations", (lease) => updateSeasonMaster(lease, id, request)),
  };
}
