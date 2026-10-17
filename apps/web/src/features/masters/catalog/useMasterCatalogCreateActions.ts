import type { QueryClient } from "@tanstack/react-query";

import {
  parseGameTitleCreate,
  parseScopedMasterCreate,
  prepareGameTitleCreation,
  prepareScopedMasterCreation,
} from "@/features/masters/catalog/catalogForms";
import type {
  OptimisticGameTitle,
  OptimisticMapMaster,
  OptimisticSeasonMaster,
} from "@/features/masters/catalog/catalogTypes";
import {
  cacheCreatedMaster,
  invalidateMasterResourceCaches,
} from "@/features/masters/masterResourceCache";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import { runIdempotentOperationAttempt } from "@/shared/api/idempotency";
import { createGameTitle, createMapMaster, createSeasonMaster } from "@/shared/api/masters";
import { formatApiError } from "@/shared/api/problemDetails";
import { masterKeys } from "@/shared/api/queryKeys";
import { useAuthorizationOperations } from "@/shared/auth/useAuthorization";
import { useAuthorizedAction } from "@/shared/auth/useAuthorizedAction";

export type MasterCreateState = { error?: string | undefined; version: number };

const initialCreateState: MasterCreateState = { version: 0 };

export function useMasterCatalogCreateActions(input: {
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
  onGameTitleCreated: (id: string) => void;
  selectedGameTitleId: string;
}) {
  const authorization = useAuthorizationOperations();
  const [gameTitleCreateState, gameTitleCreateAction, gameTitleCreatePending] =
    useAuthorizedAction<MasterCreateState>(
      authorization,
      "admin",
      async (prev, formData, lease) => {
        input.onFeedback("gameTitle", "", "");
        const parsed = parseGameTitleCreate(formData);
        if (parsed.kind === "invalid") return { ...prev, error: parsed.error };
        const attempt = input.idempotencyKeys.begin("masters.createGameTitle", parsed.request);
        const { request, optimistic } = prepareGameTitleCreation(
          parsed.request,
          attempt.key,
          input.nowIsoFactory(),
          input.optimisticGameTitleCount,
        );
        input.addOptimisticGameTitle(optimistic);
        try {
          const created = await runIdempotentOperationAttempt(attempt, (options) =>
            createGameTitle(request, options),
          );
          if (!authorization.isSameAccount(lease)) return prev;
          await cacheCreatedMaster(input.queryClient, masterKeys.gameTitles.list(), created, () =>
            authorization.isSameAccount(lease),
          );
          if (authorization.canCommit(lease)) input.onGameTitleCreated(created.id);
          await invalidateMasterResourceCaches(input.queryClient, "game-titles", () =>
            authorization.canCommit(lease),
          );
          if (!authorization.isCurrent(lease)) return prev;
          input.onFeedback("gameTitle", "", "作品を追加しました");
          return { error: undefined, version: prev.version + 1 };
        } catch (error) {
          authorization.reportError(error, lease);
          if (!authorization.isCurrent(lease)) return prev;
          return { ...prev, error: formatApiError(error, "作品の追加に失敗しました") };
        }
      },
      initialCreateState,
    );

  const [mapCreateStates, mapCreateAction, mapCreatePending] = useAuthorizedAction<
    Record<string, MasterCreateState>
  >(
    authorization,
    "operations",
    async (states, formData, lease) => {
      const scope = input.selectedGameTitleId;
      const prev = states[scope] ?? initialCreateState;
      input.onFeedback("map", input.selectedGameTitleId, "");
      const parsed = parseScopedMasterCreate("map", scope, formData);
      if (parsed.kind === "invalid") {
        return { ...states, [scope]: { ...prev, error: parsed.error } };
      }
      const gameTitleId = parsed.request.gameTitleId;
      const attempt = input.idempotencyKeys.begin("masters.createMapMaster", parsed.request);
      const { request, optimistic } = prepareScopedMasterCreation(
        "map",
        parsed.request,
        attempt.key,
        input.nowIsoFactory(),
        input.selectedMapMasterCount,
      );
      input.addOptimisticMapMaster(optimistic);
      try {
        const created = await runIdempotentOperationAttempt(attempt, (options) =>
          createMapMaster(request, options),
        );
        if (!authorization.isSameAccount(lease)) return states;
        await cacheCreatedMaster(
          input.queryClient,
          masterKeys.mapMasters.list(gameTitleId),
          created,
          () => authorization.isSameAccount(lease),
        );
        await invalidateMasterResourceCaches(input.queryClient, "map-masters", () =>
          authorization.canCommit(lease),
        );
        if (!authorization.isCurrent(lease)) return states;
        input.onFeedback("map", gameTitleId, "マップを追加しました");
        return { ...states, [scope]: { version: prev.version + 1 } };
      } catch (error) {
        authorization.reportError(error, lease);
        if (!authorization.isCurrent(lease)) return states;
        return {
          ...states,
          [scope]: { ...prev, error: formatApiError(error, "マップの追加に失敗しました") },
        };
      }
    },
    {},
  );

  const [seasonCreateStates, seasonCreateAction, seasonCreatePending] = useAuthorizedAction<
    Record<string, MasterCreateState>
  >(
    authorization,
    "operations",
    async (states, formData, lease) => {
      const scope = input.selectedGameTitleId;
      const prev = states[scope] ?? initialCreateState;
      input.onFeedback("season", input.selectedGameTitleId, "");
      const parsed = parseScopedMasterCreate("season", scope, formData);
      if (parsed.kind === "invalid") {
        return { ...states, [scope]: { ...prev, error: parsed.error } };
      }
      const gameTitleId = parsed.request.gameTitleId;
      const attempt = input.idempotencyKeys.begin("masters.createSeasonMaster", parsed.request);
      const { request, optimistic } = prepareScopedMasterCreation(
        "season",
        parsed.request,
        attempt.key,
        input.nowIsoFactory(),
        input.selectedSeasonMasterCount,
      );
      input.addOptimisticSeasonMaster(optimistic);
      try {
        const created = await runIdempotentOperationAttempt(attempt, (options) =>
          createSeasonMaster(request, options),
        );
        if (!authorization.isSameAccount(lease)) return states;
        await cacheCreatedMaster(
          input.queryClient,
          masterKeys.seasonMasters.list(gameTitleId),
          created,
          () => authorization.isSameAccount(lease),
        );
        await invalidateMasterResourceCaches(input.queryClient, "season-masters", () =>
          authorization.canCommit(lease),
        );
        if (!authorization.isCurrent(lease)) return states;
        input.onFeedback("season", gameTitleId, "シーズンを追加しました");
        return { ...states, [scope]: { version: prev.version + 1 } };
      } catch (error) {
        authorization.reportError(error, lease);
        if (!authorization.isCurrent(lease)) return states;
        return {
          ...states,
          [scope]: { ...prev, error: formatApiError(error, "シーズンの追加に失敗しました") },
        };
      }
    },
    {},
  );

  return {
    gameTitleCreateAction,
    gameTitleCreatePending,
    gameTitleCreateState,
    mapCreateAction,
    mapCreatePending,
    mapCreateState: mapCreateStates[input.selectedGameTitleId] ?? initialCreateState,
    seasonCreateAction,
    seasonCreatePending,
    seasonCreateState: seasonCreateStates[input.selectedGameTitleId] ?? initialCreateState,
  };
}
