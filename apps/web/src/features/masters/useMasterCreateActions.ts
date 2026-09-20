import type { QueryClient } from "@tanstack/react-query";
import { useActionState } from "react";

import {
  createGameTitleId,
  createMapMasterId,
  createSeasonMasterId,
} from "@/features/masters/masterId";
import {
  cacheCreatedMaster,
  invalidateMasterResourceCaches,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import { parseLayoutFamily, isNameValid, normalizeName } from "@/features/masters/masterValidation";
import type {
  OptimisticGameTitle,
  OptimisticMapMaster,
  OptimisticSeasonMaster,
} from "@/features/masters/useMasterOptimisticCatalog";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import { runIdempotentMutation, runIdempotentOperationAttempt } from "@/shared/api/idempotency";
import {
  createGameTitle,
  createMapMaster,
  createMemberAlias,
  createSeasonMaster,
} from "@/shared/api/masters";
import { formatApiError } from "@/shared/api/problemDetails";
import { masterKeys } from "@/shared/api/queryKeys";

export type CreateState = { error?: string | undefined; version: number };

const initialCreateState: CreateState = { version: 0 };

export function useMasterCreateActions(input: {
  onFeedback: (kind: string, scope: string, message: string) => void;
  addOptimisticGameTitle: (item: OptimisticGameTitle) => void;
  addOptimisticMapMaster: (item: OptimisticMapMaster) => void;
  addOptimisticSeasonMaster: (item: OptimisticSeasonMaster) => void;
  idempotencyKeys: IdempotencyKeyStore;
  nowIsoFactory: () => string;
  optimisticGameTitleCount: number;
  queryClient: QueryClient;
  selectedMapMasterCount: number;
  selectedSeasonMasterCount: number;
  setSelectedGameTitleId: (id: string) => void;
  selectedGameTitleId: string;
}) {
  const [gameTitleCreateState, gameTitleCreateAction, gameTitleCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    input.onFeedback("gameTitle", "", "");
    const name = normalizeName(String(formData.get("name") ?? ""));
    if (!isNameValid(name)) {
      return { ...prev, error: "作品名を入力してください" };
    }
    const layoutFamily = parseLayoutFamily(String(formData.get("layoutFamily") ?? ""));
    if (!layoutFamily) {
      return { ...prev, error: "読み取り方式を選択してください" };
    }
    const intent = { layoutFamily, name };
    const attempt = input.idempotencyKeys.begin("masters.createGameTitle", intent);
    const draftId = createGameTitleId(name, attempt.key);
    const createdAt = input.nowIsoFactory();
    input.addOptimisticGameTitle({
      id: draftId,
      layoutFamily,
      name,
      displayOrder: input.optimisticGameTitleCount,
      createdAt,
      pending: true,
    });
    try {
      const request = {
        id: draftId,
        layoutFamily,
        name,
      };
      const created = await runIdempotentOperationAttempt(attempt, (options) =>
        createGameTitle(request, options),
      );
      await cacheCreatedMaster(input.queryClient, masterKeys.gameTitles.list(), created);
      input.setSelectedGameTitleId(created.id);
      await invalidateMasterResourceCaches(input.queryClient, "game-titles");
      input.onFeedback("gameTitle", "", "作品を追加しました");
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: formatApiError(error, "作品の追加に失敗しました") };
    }
  }, initialCreateState);

  const [mapCreateState, mapCreateAction, mapCreatePending] = useActionState<CreateState, FormData>(
    async (prev, formData) => {
      input.onFeedback("map", input.selectedGameTitleId, "");
      const name = normalizeName(String(formData.get("name") ?? ""));
      if (!isNameValid(name) || !input.selectedGameTitleId) {
        return { ...prev, error: "マップ名を入力してください" };
      }
      const gameTitleId = input.selectedGameTitleId;
      const intent = { gameTitleId, name };
      const attempt = input.idempotencyKeys.begin("masters.createMapMaster", intent);
      const draftId = createMapMasterId(name, attempt.key);
      const createdAt = input.nowIsoFactory();
      input.addOptimisticMapMaster({
        id: draftId,
        gameTitleId,
        name,
        displayOrder: input.selectedMapMasterCount,
        createdAt,
        pending: true,
      });
      try {
        const request = {
          id: draftId,
          gameTitleId,
          name,
        };
        const created = await runIdempotentOperationAttempt(attempt, (options) =>
          createMapMaster(request, options),
        );
        await cacheCreatedMaster(
          input.queryClient,
          masterKeys.mapMasters.list(gameTitleId),
          created,
        );
        await invalidateMasterResourceCaches(input.queryClient, "map-masters");
        input.onFeedback("map", gameTitleId, "マップを追加しました");
        return { error: undefined, version: prev.version + 1 };
      } catch (error) {
        return { ...prev, error: formatApiError(error, "マップの追加に失敗しました") };
      }
    },
    initialCreateState,
  );

  const [seasonCreateState, seasonCreateAction, seasonCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    input.onFeedback("season", input.selectedGameTitleId, "");
    const name = normalizeName(String(formData.get("name") ?? ""));
    if (!isNameValid(name) || !input.selectedGameTitleId) {
      return { ...prev, error: "シーズン名を入力してください" };
    }
    const gameTitleId = input.selectedGameTitleId;
    const intent = { gameTitleId, name };
    const attempt = input.idempotencyKeys.begin("masters.createSeasonMaster", intent);
    const draftId = createSeasonMasterId(name, attempt.key);
    const createdAt = input.nowIsoFactory();
    input.addOptimisticSeasonMaster({
      id: draftId,
      gameTitleId,
      name,
      displayOrder: input.selectedSeasonMasterCount,
      createdAt,
      pending: true,
    });
    try {
      const request = {
        id: draftId,
        gameTitleId,
        name,
      };
      const created = await runIdempotentOperationAttempt(attempt, (options) =>
        createSeasonMaster(request, options),
      );
      await cacheCreatedMaster(
        input.queryClient,
        masterKeys.seasonMasters.list(gameTitleId),
        created,
      );
      await invalidateMasterResourceCaches(input.queryClient, "season-masters");
      input.onFeedback("season", gameTitleId, "シーズンを追加しました");
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: formatApiError(error, "シーズンの追加に失敗しました") };
    }
  }, initialCreateState);

  const [aliasCreateState, aliasCreateAction, aliasCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    input.onFeedback("aliases", "", "");
    const memberId = normalizeName(String(formData.get("memberId") ?? ""));
    const alias = normalizeName(String(formData.get("alias") ?? ""));
    if (!memberId || !alias) {
      return { ...prev, error: "プレーヤーと別名を入力してください" };
    }
    try {
      const request = { memberId, alias };
      const created = await runIdempotentMutation(
        input.idempotencyKeys,
        "masters.createMemberAlias",
        request,
        (options) => createMemberAlias(request, options),
      );
      await cacheCreatedMaster(input.queryClient, masterKeys.memberAliases.list(), created);
      await invalidateMemberAliasCaches(input.queryClient);
      input.onFeedback("aliases", "", "別名を追加しました");
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: formatApiError(error, "別名の追加に失敗しました") };
    }
  }, initialCreateState);

  return {
    aliasCreateAction,
    aliasCreatePending,
    aliasCreateState,
    gameTitleCreateAction,
    gameTitleCreatePending,
    gameTitleCreateState,
    mapCreateAction,
    mapCreatePending,
    mapCreateState,
    seasonCreateAction,
    seasonCreatePending,
    seasonCreateState,
  };
}
