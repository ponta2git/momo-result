import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  invalidateMasterResourceCaches,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import { parseLayoutFamily, normalizeName } from "@/features/masters/masterValidation";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import {
  deleteGameTitle,
  deleteMapMaster,
  deleteMemberAlias,
  deleteSeasonMaster,
  updateGameTitle as updateGameTitleResource,
  updateMapMaster as updateMapMasterResource,
  updateMemberAlias as updateMemberAliasResource,
  updateSeasonMaster as updateSeasonMasterResource,
} from "@/shared/api/masters";

export function useMasterEditCommands(input: {
  authScope: string;
  idempotencyKeys: IdempotencyKeyStore;
  queryClient: QueryClient;
  selectedGameTitleId: string;
  setOperationError: (message: string | undefined) => void;
  setSelectedGameTitleId: (id: string) => void;
}) {
  const {
    authScope,
    idempotencyKeys,
    queryClient,
    selectedGameTitleId,
    setOperationError,
    setSelectedGameTitleId,
  } = input;
  const [pendingMutationCount, setPendingMutationCount] = useState(0);

  const trackMutation = useCallback(async <Result>(action: () => Promise<Result>) => {
    setPendingMutationCount((count) => count + 1);
    try {
      return await action();
    } finally {
      setPendingMutationCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const deleteWithDialogFeedback = useCallback(
    async (action: () => Promise<unknown>) => {
      setOperationError(undefined);
      await action();
    },
    [setOperationError],
  );

  const updateGameTitle = useCallback(
    async (id: string, request: { name: string; layoutFamily: string }) => {
      setOperationError(undefined);
      const layoutFamily = parseLayoutFamily(request.layoutFamily);
      if (!layoutFamily) {
        setOperationError("読み取り方式を選択してください");
        return;
      }
      const normalizedRequest = {
        name: normalizeName(request.name),
        layoutFamily,
      };
      await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateGameTitle",
        { id, request: normalizedRequest },
        (options) => updateGameTitleResource(id, normalizedRequest, options),
      );
      await invalidateMasterResourceCaches(queryClient, {
        authScope,
        resource: "game-titles",
      });
    },
    [authScope, idempotencyKeys, queryClient, setOperationError],
  );

  const updateMapMaster = useCallback(
    async (id: string, request: { name: string }) => {
      setOperationError(undefined);
      const normalizedRequest = { name: normalizeName(request.name) };
      await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateMapMaster",
        { id, request: normalizedRequest },
        (options) => updateMapMasterResource(id, normalizedRequest, options),
      );
      await invalidateMasterResourceCaches(queryClient, {
        authScope,
        gameTitleId: selectedGameTitleId,
        resource: "map-masters",
      });
    },
    [authScope, idempotencyKeys, queryClient, selectedGameTitleId, setOperationError],
  );

  const updateSeasonMaster = useCallback(
    async (id: string, request: { name: string }) => {
      setOperationError(undefined);
      const normalizedRequest = { name: normalizeName(request.name) };
      await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateSeasonMaster",
        { id, request: normalizedRequest },
        (options) => updateSeasonMasterResource(id, normalizedRequest, options),
      );
      await invalidateMasterResourceCaches(queryClient, {
        authScope,
        gameTitleId: selectedGameTitleId,
        resource: "season-masters",
      });
    },
    [authScope, idempotencyKeys, queryClient, selectedGameTitleId, setOperationError],
  );

  const updateMemberAlias = useCallback(
    async (id: string, request: { memberId: string; alias: string }) => {
      setOperationError(undefined);
      const normalizedRequest = {
        memberId: normalizeName(request.memberId),
        alias: normalizeName(request.alias),
      };
      await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateMemberAlias",
        { id, request: normalizedRequest },
        (options) => updateMemberAliasResource(id, normalizedRequest, options),
      );
      await invalidateMemberAliasCaches(queryClient, authScope);
    },
    [authScope, idempotencyKeys, queryClient, setOperationError],
  );

  return {
    deleteGameTitle: (id: string) =>
      trackMutation(() =>
        deleteWithDialogFeedback(async () => {
          await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteGameTitle",
            { id },
            (options) => deleteGameTitle(id, options),
          );
          if (selectedGameTitleId === id) {
            setSelectedGameTitleId("");
          }
          await invalidateMasterResourceCaches(queryClient, {
            authScope,
            resource: "game-titles",
          });
        }),
      ),
    deleteMapMaster: (id: string) =>
      trackMutation(() =>
        deleteWithDialogFeedback(async () => {
          await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteMapMaster",
            { id },
            (options) => deleteMapMaster(id, options),
          );
          await invalidateMasterResourceCaches(queryClient, {
            authScope,
            gameTitleId: selectedGameTitleId,
            resource: "map-masters",
          });
        }),
      ),
    deleteMemberAlias: (id: string) =>
      trackMutation(() =>
        deleteWithDialogFeedback(async () => {
          await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteMemberAlias",
            { id },
            (options) => deleteMemberAlias(id, options),
          );
          await invalidateMemberAliasCaches(queryClient, authScope);
        }),
      ),
    deleteSeasonMaster: (id: string) =>
      trackMutation(() =>
        deleteWithDialogFeedback(async () => {
          await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteSeasonMaster",
            { id },
            (options) => deleteSeasonMaster(id, options),
          );
          await invalidateMasterResourceCaches(queryClient, {
            authScope,
            gameTitleId: selectedGameTitleId,
            resource: "season-masters",
          });
        }),
      ),
    editPending: pendingMutationCount > 0,
    updateGameTitle: (id: string, request: { name: string; layoutFamily: string }) =>
      trackMutation(() => updateGameTitle(id, request)),
    updateMapMaster: (id: string, request: { name: string }) =>
      trackMutation(() => updateMapMaster(id, request)),
    updateMemberAlias: (id: string, request: { memberId: string; alias: string }) =>
      trackMutation(() => updateMemberAlias(id, request)),
    updateSeasonMaster: (id: string, request: { name: string }) =>
      trackMutation(() => updateSeasonMaster(id, request)),
  };
}
