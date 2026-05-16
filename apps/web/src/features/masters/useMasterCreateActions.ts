import type { QueryClient } from "@tanstack/react-query";
import { useActionState } from "react";

import {
  postGameTitle,
  postMapMaster,
  postMemberAlias,
  postSeasonMaster,
} from "@/features/masters/masterCommands";
import {
  createGameTitleId,
  createMapMasterId,
  createSeasonMasterId,
} from "@/features/masters/masterId";
import { masterQueryKeys } from "@/features/masters/masterQueries";
import {
  invalidateMasterResourceCaches,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import type { MasterViewModel } from "@/features/masters/masterTypes";
import { parseLayoutFamily, isNameValid, normalizeName } from "@/features/masters/masterValidation";
import type {
  OptimisticGameTitle,
  OptimisticMapMaster,
  OptimisticSeasonMaster,
} from "@/features/masters/useMasterOptimisticCatalog";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import { runIdempotentMutation, runIdempotentOperationAttempt } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";

export type CreateState = { error?: string | undefined; version: number };

const initialCreateState: CreateState = { version: 0 };

export function useMasterCreateActions(input: {
  addOptimisticGameTitle: (item: OptimisticGameTitle) => void;
  addOptimisticMapMaster: (item: OptimisticMapMaster) => void;
  addOptimisticSeasonMaster: (item: OptimisticSeasonMaster) => void;
  authScope: string;
  idempotencyKeys: IdempotencyKeyStore;
  nowIsoFactory: () => string;
  optimisticGameTitleCount: number;
  queryClient: QueryClient;
  selectedMapMasterCount: number;
  selectedSeasonMasterCount: number;
  setSelectedGameTitleId: (id: string) => void;
  viewModel: MasterViewModel;
}) {
  const [gameTitleCreateState, gameTitleCreateAction, gameTitleCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    const name = normalizeName(String(formData.get("name") ?? ""));
    if (!isNameValid(name)) {
      return { ...prev, error: "作品名を入力してください" };
    }
    const layoutFamily = parseLayoutFamily(String(formData.get("layoutFamily") ?? ""));
    if (!layoutFamily) {
      return { ...prev, error: "作品種別を選択してください" };
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
        postGameTitle(request, options),
      );
      input.setSelectedGameTitleId(created.id);
      await invalidateMasterResourceCaches(
        input.queryClient,
        masterQueryKeys.gameTitles(input.authScope),
        "game-titles",
      );
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: formatApiError(error, "作品の追加に失敗しました") };
    }
  }, initialCreateState);

  const [mapCreateState, mapCreateAction, mapCreatePending] = useActionState<CreateState, FormData>(
    async (prev, formData) => {
      const name = normalizeName(String(formData.get("name") ?? ""));
      if (!isNameValid(name) || !input.viewModel.selectedGameTitleId) {
        return { ...prev, error: "マップ名を入力してください" };
      }
      const gameTitleId = input.viewModel.selectedGameTitleId;
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
        await runIdempotentOperationAttempt(attempt, (options) => postMapMaster(request, options));
        await invalidateMasterResourceCaches(
          input.queryClient,
          masterQueryKeys.mapMasters(input.authScope, gameTitleId),
          "map-masters",
        );
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
    const name = normalizeName(String(formData.get("name") ?? ""));
    if (!isNameValid(name) || !input.viewModel.selectedGameTitleId) {
      return { ...prev, error: "シーズン名を入力してください" };
    }
    const gameTitleId = input.viewModel.selectedGameTitleId;
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
      await runIdempotentOperationAttempt(attempt, (options) => postSeasonMaster(request, options));
      await invalidateMasterResourceCaches(
        input.queryClient,
        masterQueryKeys.seasonMasters(input.authScope, gameTitleId),
        "season-masters",
      );
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: formatApiError(error, "シーズンの追加に失敗しました") };
    }
  }, initialCreateState);

  const [aliasCreateState, aliasCreateAction, aliasCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    const memberId = normalizeName(String(formData.get("memberId") ?? ""));
    const alias = normalizeName(String(formData.get("alias") ?? ""));
    if (!memberId || !alias) {
      return { ...prev, error: "プレーヤーと別名を入力してください" };
    }
    try {
      const request = { memberId, alias };
      await runIdempotentMutation(
        input.idempotencyKeys,
        "masters.createMemberAlias",
        request,
        (options) => postMemberAlias(request, options),
      );
      await invalidateMemberAliasCaches(input.queryClient, input.authScope);
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
