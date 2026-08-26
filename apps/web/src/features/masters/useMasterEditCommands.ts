import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  patchGameTitle,
  patchMapMaster,
  patchMemberAlias,
  patchSeasonMaster,
  removeGameTitle,
  removeMapMaster,
  removeMemberAlias,
  removeSeasonMaster,
} from "@/features/masters/masterCommands";
import {
  invalidateMasterResourceCaches,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import { parseLayoutFamily, normalizeName } from "@/features/masters/masterValidation";

export function useMasterEditCommands(input: {
  authScope: string;
  queryClient: QueryClient;
  selectedGameTitleId: string;
  setOperationError: (message: string | undefined) => void;
  setSelectedGameTitleId: (id: string) => void;
}) {
  const { authScope, queryClient, selectedGameTitleId, setOperationError, setSelectedGameTitleId } =
    input;
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
        setOperationError("作品種別を選択してください");
        return;
      }
      await patchGameTitle(id, {
        name: normalizeName(request.name),
        layoutFamily,
      });
      await invalidateMasterResourceCaches(queryClient, {
        authScope,
        resource: "game-titles",
      });
    },
    [authScope, queryClient, setOperationError],
  );

  const updateMapMaster = useCallback(
    async (id: string, request: { name: string }) => {
      setOperationError(undefined);
      await patchMapMaster(id, { name: normalizeName(request.name) });
      await invalidateMasterResourceCaches(queryClient, {
        authScope,
        gameTitleId: selectedGameTitleId,
        resource: "map-masters",
      });
    },
    [authScope, queryClient, selectedGameTitleId, setOperationError],
  );

  const updateSeasonMaster = useCallback(
    async (id: string, request: { name: string }) => {
      setOperationError(undefined);
      await patchSeasonMaster(id, { name: normalizeName(request.name) });
      await invalidateMasterResourceCaches(queryClient, {
        authScope,
        gameTitleId: selectedGameTitleId,
        resource: "season-masters",
      });
    },
    [authScope, queryClient, selectedGameTitleId, setOperationError],
  );

  const updateMemberAlias = useCallback(
    async (id: string, request: { memberId: string; alias: string }) => {
      setOperationError(undefined);
      await patchMemberAlias(id, {
        memberId: normalizeName(request.memberId),
        alias: normalizeName(request.alias),
      });
      await invalidateMemberAliasCaches(queryClient, authScope);
    },
    [authScope, queryClient, setOperationError],
  );

  return {
    deleteGameTitle: (id: string) =>
      trackMutation(() =>
        deleteWithDialogFeedback(async () => {
          await removeGameTitle(id);
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
          await removeMapMaster(id);
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
          await removeMemberAlias(id);
          await invalidateMemberAliasCaches(queryClient, authScope);
        }),
      ),
    deleteSeasonMaster: (id: string) =>
      trackMutation(() =>
        deleteWithDialogFeedback(async () => {
          await removeSeasonMaster(id);
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
