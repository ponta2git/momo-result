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
import { useMasterCatalogWrites } from "@/features/masters/catalog/useMasterCatalogWrites";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
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
  readNowIso: () => string;
  optimisticGameTitleCount: number;
  selectedMapMasterCount: number;
  selectedSeasonMasterCount: number;
  onGameTitleCreated: (id: string) => void;
  selectedGameTitleId: string;
}) {
  const authorization = useAuthorizationOperations();
  const writes = useMasterCatalogWrites(input.idempotencyKeys);
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
          input.readNowIso(),
          input.optimisticGameTitleCount,
        );
        input.addOptimisticGameTitle(optimistic);
        try {
          await writes.createGameTitle(attempt, request, lease, input.onGameTitleCreated);
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
        parsed.request,
        attempt.key,
        input.readNowIso(),
        input.selectedMapMasterCount,
      );
      input.addOptimisticMapMaster(optimistic);
      try {
        await writes.createMapMaster(attempt, request, lease);
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
        parsed.request,
        attempt.key,
        input.readNowIso(),
        input.selectedSeasonMasterCount,
      );
      input.addOptimisticSeasonMaster(optimistic);
      try {
        await writes.createSeasonMaster(attempt, request, lease);
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
