import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { defaultLayoutFamily } from "@/features/masters/masterValidation";
import { useMasterCreateActions } from "@/features/masters/useMasterCreateActions";
import { useMasterEditCommands } from "@/features/masters/useMasterEditCommands";
import { useMasterOptimisticCatalog } from "@/features/masters/useMasterOptimisticCatalog";
import { useMasterResourceQueries } from "@/features/masters/useMasterResourceQueries";
import { useMasterReturnRoute } from "@/features/masters/useMasterReturnRoute";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useAuth } from "@/shared/auth/useAuth";

export const masterTabs = [
  { id: "catalog", label: "作品・マップ・シーズン" },
  { id: "aliases", label: "メンバー名寄せ" },
  { id: "incidents", label: "事件簿" },
] as const;

export type MasterTabId = (typeof masterTabs)[number]["id"];

function isMasterTabId(value: string | null): value is MasterTabId {
  return masterTabs.some((tab) => tab.id === value);
}

export function errorMessage(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }
  const normalized = normalizeUnknownApiError(error);
  return normalized.detail || normalized.title;
}

/**
 * Composes settings resources and commands into display-ready page sections.
 * Query and command hook implementation details stay behind this contract.
 */
export function useMastersPageModel() {
  const auth = useAuth();
  const authScope = auth.auth?.accountId ?? "anonymous";
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const [isReturnNavigationPending, startReturnTransition] = useTransition();
  const navigateWithTransition = (to: string) => {
    startReturnTransition(() => {
      navigate(to);
    });
  };

  const [selectedGameTitleId, setSelectedGameTitleId] = useState("");
  const rawTab = searchParams.get("tab");
  const activeTab: MasterTabId = isMasterTabId(rawTab) ? rawTab : "catalog";
  const setActiveTab = useCallback(
    (nextTab: MasterTabId) => {
      const next = new URLSearchParams(searchParams);
      if (nextTab === "catalog") {
        next.delete("tab");
      } else {
        next.set("tab", nextTab);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [operationError, setOperationError] = useState<string>();
  const returnRoute = useMasterReturnRoute(auth.auth?.accountId);

  useEffect(() => {
    if (!rawTab || isMasterTabId(rawTab)) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [rawTab, searchParams, setSearchParams]);

  const resourceQueries = useMasterResourceQueries(authScope, selectedGameTitleId);
  const { gameTitles, mapMasters, seasonMasters } = resourceQueries;
  const optimisticCatalog = useMasterOptimisticCatalog({
    gameTitles,
    mapMasters,
    seasonMasters,
    selectedGameTitleId,
  });
  const { viewModel } = optimisticCatalog;

  useEffect(() => {
    if (gameTitles.length === 0) {
      setSelectedGameTitleId("");
      return;
    }
    const exists = gameTitles.some((item) => item.id === selectedGameTitleId);
    if (!exists) {
      const first = gameTitles[0];
      if (first) {
        setSelectedGameTitleId(first.id);
      }
    }
  }, [gameTitles, selectedGameTitleId]);

  const createActions = useMasterCreateActions({
    addOptimisticGameTitle: optimisticCatalog.addOptimisticGameTitle,
    addOptimisticMapMaster: optimisticCatalog.addOptimisticMapMaster,
    addOptimisticSeasonMaster: optimisticCatalog.addOptimisticSeasonMaster,
    authScope,
    idempotencyKeys,
    nowIsoFactory,
    optimisticGameTitleCount: optimisticCatalog.optimisticGameTitles.length,
    queryClient,
    selectedMapMasterCount: viewModel.selectedMapMasters.length,
    selectedSeasonMasterCount: viewModel.selectedSeasonMasters.length,
    setSelectedGameTitleId,
    viewModel,
  });

  const editCommands = useMasterEditCommands({
    authScope,
    queryClient,
    selectedGameTitleId: viewModel.selectedGameTitleId,
    setOperationError,
    setSelectedGameTitleId,
  });

  const hasPendingMutation =
    createActions.gameTitleCreatePending ||
    createActions.mapCreatePending ||
    createActions.seasonCreatePending ||
    createActions.aliasCreatePending ||
    editCommands.editPending;
  const gameTitlesHasError = shouldShowQueryError(resourceQueries.gameTitlesQuery);
  const incidentMastersHasError = shouldShowQueryError(resourceQueries.incidentMastersQuery);
  const mapMastersHasData = resourceQueries.mapMastersQuery.data !== undefined;
  const mapMastersHasError = shouldShowQueryError(resourceQueries.mapMastersQuery);
  const memberAliasesHasError = shouldShowQueryError(resourceQueries.memberAliasesQuery);
  const seasonMastersHasData = resourceQueries.seasonMastersQuery.data !== undefined;
  const seasonMastersHasError = shouldShowQueryError(resourceQueries.seasonMastersQuery);

  return {
    aliases: {
      createAction: createActions.aliasCreateAction,
      createError: createActions.aliasCreateState.error,
      createFormKey: createActions.aliasCreateState.version,
      items: resourceQueries.memberAliases,
      onDelete: editCommands.deleteMemberAlias,
      onRetry: () => void resourceQueries.memberAliasesQuery.refetch(),
      onUpdate: editCommands.updateMemberAlias,
      refreshing: resourceQueries.memberAliasesQuery.isFetching,
      stale: memberAliasesHasError && resourceQueries.memberAliasesQuery.data !== undefined,
    },
    auth,
    catalog: {
      gameTitle: {
        create: {
          action: createActions.gameTitleCreateAction,
          error: createActions.gameTitleCreateState.error,
          formKey: createActions.gameTitleCreateState.version,
          pending: createActions.gameTitleCreatePending,
        },
        defaultLayoutFamily,
        items: optimisticCatalog.optimisticGameTitles,
        onDelete: editCommands.deleteGameTitle,
        onRetry: () => void resourceQueries.gameTitlesQuery.refetch(),
        onSelect: setSelectedGameTitleId,
        onUpdate: editCommands.updateGameTitle,
        refreshing: resourceQueries.gameTitlesQuery.isFetching,
        selectedId: viewModel.selectedGameTitleId,
        stale: gameTitlesHasError && resourceQueries.gameTitlesQuery.data !== undefined,
      },
      map: {
        create: {
          action: createActions.mapCreateAction,
          error: createActions.mapCreateState.error,
          formKey: createActions.mapCreateState.version,
          pending: createActions.mapCreatePending,
        },
        error: mapMastersHasError ? errorMessage(resourceQueries.mapMastersQuery.error) : undefined,
        hasData: mapMastersHasData,
        items: viewModel.selectedMapMasters,
        loadFailed: shouldShowBlockingQueryError(resourceQueries.mapMastersQuery),
        loading: isInitialQueryLoading(resourceQueries.mapMastersQuery),
        onDelete: editCommands.deleteMapMaster,
        onRetry: () => void resourceQueries.mapMastersQuery.refetch(),
        onUpdate: editCommands.updateMapMaster,
        retrying: resourceQueries.mapMastersQuery.isFetching,
        stale: mapMastersHasError && mapMastersHasData,
      },
      scopedDisabledReason: viewModel.scopedDisabledReason,
      season: {
        create: {
          action: createActions.seasonCreateAction,
          error: createActions.seasonCreateState.error,
          formKey: createActions.seasonCreateState.version,
          pending: createActions.seasonCreatePending,
        },
        error: seasonMastersHasError
          ? errorMessage(resourceQueries.seasonMastersQuery.error)
          : undefined,
        hasData: seasonMastersHasData,
        items: viewModel.selectedSeasonMasters,
        loadFailed: shouldShowBlockingQueryError(resourceQueries.seasonMastersQuery),
        loading: isInitialQueryLoading(resourceQueries.seasonMastersQuery),
        onDelete: editCommands.deleteSeasonMaster,
        onRetry: () => void resourceQueries.seasonMastersQuery.refetch(),
        onUpdate: editCommands.updateSeasonMaster,
        retrying: resourceQueries.seasonMastersQuery.isFetching,
        stale: seasonMastersHasError && seasonMastersHasData,
      },
    },
    feedback: {
      invalidReturnTo: returnRoute.hasInvalidReturnTo,
      operationError,
    },
    incidents: {
      items: resourceQueries.incidentMasters,
      onRetry: () => void resourceQueries.incidentMastersQuery.refetch(),
      refreshing: resourceQueries.incidentMastersQuery.isFetching,
      stale: incidentMastersHasError && resourceQueries.incidentMastersQuery.data !== undefined,
    },
    navigation: {
      disabled: hasPendingMutation || isReturnNavigationPending,
      disabledReason: isReturnNavigationPending
        ? "元の入力画面へ移動しています。"
        : hasPendingMutation
          ? "設定の追加・保存・削除が完了すると戻れます。"
          : undefined,
      destination: returnRoute.returnDestination,
      handoffStatus: returnRoute.handoffStatus,
      pending: isReturnNavigationPending,
      onReturn: () => {
        if (returnRoute.returnDestination) {
          navigateWithTransition(returnRoute.returnDestination);
        }
      },
    },
    tabs: {
      active: activeTab,
      items: masterTabs,
      onChange: setActiveTab,
    },
  };
}
