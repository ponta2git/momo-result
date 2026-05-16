import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

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
import { formatApiError } from "@/shared/api/problemDetails";

export function useMasterEditCommands(input: {
  authScope: string;
  queryClient: QueryClient;
  selectedGameTitleId: string;
  setOperationError: (message: string | undefined) => void;
  setSelectedGameTitleId: (id: string) => void;
}) {
  const { authScope, queryClient, selectedGameTitleId, setOperationError, setSelectedGameTitleId } =
    input;

  const deleteWithNotice = useCallback(
    async (action: () => Promise<unknown>, fallback: string) => {
      setOperationError(undefined);
      try {
        await action();
      } catch (error) {
        setOperationError(formatApiError(error, fallback));
        throw error;
      }
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
      deleteWithNotice(async () => {
        await removeGameTitle(id);
        if (selectedGameTitleId === id) {
          setSelectedGameTitleId("");
        }
        await invalidateMasterResourceCaches(queryClient, {
          authScope,
          resource: "game-titles",
        });
      }, "作品の削除に失敗しました"),
    deleteMapMaster: (id: string) =>
      deleteWithNotice(async () => {
        await removeMapMaster(id);
        await invalidateMasterResourceCaches(queryClient, {
          authScope,
          gameTitleId: selectedGameTitleId,
          resource: "map-masters",
        });
      }, "マップの削除に失敗しました"),
    deleteMemberAlias: (id: string) =>
      deleteWithNotice(async () => {
        await removeMemberAlias(id);
        await invalidateMemberAliasCaches(queryClient, authScope);
      }, "エイリアスの削除に失敗しました"),
    deleteSeasonMaster: (id: string) =>
      deleteWithNotice(async () => {
        await removeSeasonMaster(id);
        await invalidateMasterResourceCaches(queryClient, {
          authScope,
          gameTitleId: selectedGameTitleId,
          resource: "season-masters",
        });
      }, "シーズンの削除に失敗しました"),
    updateGameTitle,
    updateMapMaster,
    updateMemberAlias,
    updateSeasonMaster,
  };
}
