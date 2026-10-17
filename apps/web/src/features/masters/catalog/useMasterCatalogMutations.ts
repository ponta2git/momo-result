import { useCallback, useState } from "react";

import {
  normalizeGameTitleEdit,
  normalizeMasterNameEdit,
} from "@/features/masters/catalog/catalogForms";
import { useMasterCatalogWrites } from "@/features/masters/catalog/useMasterCatalogWrites";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import type { ManagementPermission } from "@/shared/auth/permissions";
import { useAuthorizationOperations } from "@/shared/auth/useAuthorization";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useMasterCatalogMutations(input: {
  onFeedback: (kind: string, scope: string, message: string) => void;
  idempotencyKeys: IdempotencyKeyStore;
  selectedGameTitleId: string;
  onGameTitleDeleted: (id: string) => void;
}) {
  const authorization = useAuthorizationOperations();
  const { onFeedback, idempotencyKeys, selectedGameTitleId, onGameTitleDeleted } = input;
  const writes = useMasterCatalogWrites(idempotencyKeys);
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
      await writes.updateGameTitle(id, parsed.request, lease);
      if (authorization.isCurrent(lease)) onFeedback("gameTitle", "", "作品を保存しました");
    },
    [authorization, onFeedback, writes],
  );

  const updateMapMaster = useCallback(
    async (lease: AuthorizationLease, id: string, request: { name: string }) => {
      onFeedback("map", selectedGameTitleId, "");
      setOperationError(undefined);
      await writes.updateMapMaster(id, normalizeMasterNameEdit(request), lease);
      if (authorization.isCurrent(lease))
        onFeedback("map", selectedGameTitleId, "マップを保存しました");
    },
    [authorization, onFeedback, selectedGameTitleId, writes],
  );

  const updateSeasonMaster = useCallback(
    async (lease: AuthorizationLease, id: string, request: { name: string }) => {
      onFeedback("season", selectedGameTitleId, "");
      setOperationError(undefined);
      await writes.updateSeasonMaster(id, normalizeMasterNameEdit(request), lease);
      if (authorization.isCurrent(lease))
        onFeedback("season", selectedGameTitleId, "シーズンを保存しました");
    },
    [authorization, onFeedback, selectedGameTitleId, writes],
  );

  return {
    operationError,
    deleteGameTitle: (id: string) =>
      trackMutation("admin", (lease) =>
        deleteWithDialogFeedback(async () => {
          onFeedback("gameTitle", "", "");
          await writes.deleteGameTitle(id, lease, onGameTitleDeleted);
          if (authorization.canCommit(lease))
            showToast({ title: "作品を削除しました", tone: "success" });
        }),
      ),
    deleteMapMaster: (id: string) =>
      trackMutation("operations", (lease) =>
        deleteWithDialogFeedback(async () => {
          onFeedback("map", selectedGameTitleId, "");
          await writes.deleteMapMaster(id, lease);
          if (authorization.canCommit(lease))
            showToast({ title: "マップを削除しました", tone: "success" });
        }),
      ),
    deleteSeasonMaster: (id: string) =>
      trackMutation("operations", (lease) =>
        deleteWithDialogFeedback(async () => {
          onFeedback("season", selectedGameTitleId, "");
          await writes.deleteSeasonMaster(id, lease);
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
