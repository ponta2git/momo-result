import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useOptimistic, useState, useTransition } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAccountSettingsModel } from "@/features/masters/accounts/useAccountSettingsModel";
import { defaultLayoutFamily } from "@/features/masters/masterValidation";
import { useNotificationSettingsModel } from "@/features/masters/notifications/useNotificationSettingsModel";
import { useMasterCreateActions } from "@/features/masters/useMasterCreateActions";
import { useMasterEditCommands } from "@/features/masters/useMasterEditCommands";
import { useMasterOptimisticCatalog } from "@/features/masters/useMasterOptimisticCatalog";
import { useMasterResourceQueries } from "@/features/masters/useMasterResourceQueries";
import { useMasterReturnRoute } from "@/features/masters/useMasterReturnRoute";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useAuth } from "@/shared/auth/useAuth";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

export const masterTabs = [
  { id: "catalog", label: "作品・マップ・シーズン" },
  { id: "aliases", label: "メンバー名寄せ" },
  { id: "incidents", label: "事件簿" },
  { id: "notifications", label: "通知" },
  { id: "accounts", label: "アカウント" },
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
  const urlTab: MasterTabId = isMasterTabId(rawTab) ? rawTab : "catalog";
  const [activeTab, setOptimisticTab] = useOptimistic(urlTab);
  const [, startTabTransition] = useTransition();
  const [openedTabs, setOpenedTabs] = useState<MasterTabId[]>([activeTab]);
  if (!openedTabs.includes(activeTab)) {
    setOpenedTabs([...openedTabs, activeTab]);
  }
  const setActiveTab = useCallback(
    (nextTab: MasterTabId) => {
      const next = new URLSearchParams(searchParams);
      if (nextTab === "catalog") {
        next.delete("tab");
      } else {
        next.set("tab", nextTab);
      }
      startTabTransition(() => {
        setOptimisticTab(nextTab);
        setSearchParams(next, { replace: true });
      });
    },
    [searchParams, setOptimisticTab, setSearchParams],
  );
  const [completions, setCompletions] = useState<Record<string, string>>({});
  const onFeedback = useCallback((kind: string, scope: string, message: string) => {
    setCompletions((current) => ({ ...current, [`${kind}:${scope}`]: message }));
  }, []);
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

  // Keep visited resources mounted and enabled: switching tabs must not become a reload.
  const notifications = useNotificationSettingsModel(openedTabs.includes("notifications"));
  const accounts = useAccountSettingsModel(openedTabs.includes("accounts"));
  const resourceQueries = useMasterResourceQueries(selectedGameTitleId, {
    catalog: openedTabs.includes("catalog"),
    aliases: openedTabs.includes("aliases"),
    incidents: openedTabs.includes("incidents"),
  });
  const { gameTitles, mapMasters, seasonMasters } = resourceQueries;
  const optimisticCatalog = useMasterOptimisticCatalog({
    fallbackSelectedGameTitleId: resourceQueries.selectedGameTitleId,
    gameTitles,
    mapMasters,
    seasonMasters,
    selectedGameTitleId,
  });
  const { viewModel } = optimisticCatalog;

  const createActions = useMasterCreateActions({
    onFeedback,
    addOptimisticGameTitle: optimisticCatalog.addOptimisticGameTitle,
    addOptimisticMapMaster: optimisticCatalog.addOptimisticMapMaster,
    addOptimisticSeasonMaster: optimisticCatalog.addOptimisticSeasonMaster,
    idempotencyKeys,
    nowIsoFactory,
    optimisticGameTitleCount: optimisticCatalog.optimisticGameTitles.length,
    queryClient,
    selectedMapMasterCount: viewModel.selectedMapMasters.length,
    selectedSeasonMasterCount: viewModel.selectedSeasonMasters.length,
    setSelectedGameTitleId,
    selectedGameTitleId: viewModel.selectedGameTitleId,
  });

  const editCommands = useMasterEditCommands({
    onFeedback,
    idempotencyKeys,
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
  const gameTitlesHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.gameTitlesQuery),
    resourceQueries.gameTitlesQuery.isFetching,
    authScope,
  );
  const incidentMastersHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.incidentMastersQuery),
    resourceQueries.incidentMastersQuery.isFetching,
    authScope,
  );
  const mapMastersHasData = resourceQueries.mapMastersQuery.data !== undefined;
  const mapMastersHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.mapMastersQuery),
    resourceQueries.mapMastersQuery.isFetching,
    `${authScope}:${resourceQueries.selectedGameTitleId}`,
  );
  const memberAliasesHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.memberAliasesQuery),
    resourceQueries.memberAliasesQuery.isFetching,
    authScope,
  );
  const seasonMastersHasData = resourceQueries.seasonMastersQuery.data !== undefined;
  const seasonMastersHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.seasonMastersQuery),
    resourceQueries.seasonMastersQuery.isFetching,
    `${authScope}:${resourceQueries.selectedGameTitleId}`,
  );

  const mapError = useRetryNotice(
    errorMessage(resourceQueries.mapMastersQuery.error),
    resourceQueries.mapMastersQuery.isFetching,
    resourceQueries.selectedGameTitleId,
  );
  const seasonError = useRetryNotice(
    errorMessage(resourceQueries.seasonMastersQuery.error),
    resourceQueries.seasonMastersQuery.isFetching,
    resourceQueries.selectedGameTitleId,
  );

  return {
    aliases: {
      hasData: resourceQueries.memberAliasesQuery.data !== undefined,
      loadFailed: memberAliasesHasError && resourceQueries.memberAliasesQuery.data === undefined,
      completion: completions["aliases:"],
      createAction: createActions.aliasCreateAction,
      createError: createActions.aliasCreateState.error,
      createFormKey: createActions.aliasCreateState.version,
      createPending: createActions.aliasCreatePending,
      items: resourceQueries.memberAliases,
      onDelete: editCommands.deleteMemberAlias,
      onRetry: async () => (await resourceQueries.memberAliasesQuery.refetch()).isSuccess,
      onUpdate: editCommands.updateMemberAlias,
      refreshing: resourceQueries.memberAliasesQuery.isFetching && !hasPendingMutation,
      stale: memberAliasesHasError && resourceQueries.memberAliasesQuery.data !== undefined,
    },
    catalog: {
      gameTitle: {
        hasData: resourceQueries.gameTitlesQuery.data !== undefined,
        loadFailed: gameTitlesHasError && resourceQueries.gameTitlesQuery.data === undefined,
        completion: completions["gameTitle:"],
        create: {
          action: createActions.gameTitleCreateAction,
          error: createActions.gameTitleCreateState.error,
          formKey: createActions.gameTitleCreateState.version,
          pending: createActions.gameTitleCreatePending,
        },
        defaultLayoutFamily,
        items: optimisticCatalog.optimisticGameTitles,
        onDelete: editCommands.deleteGameTitle,
        onRetry: async () => (await resourceQueries.gameTitlesQuery.refetch()).isSuccess,
        onSelect: setSelectedGameTitleId,
        onUpdate: editCommands.updateGameTitle,
        refreshing: resourceQueries.gameTitlesQuery.isFetching && !hasPendingMutation,
        selectedId: viewModel.selectedGameTitleId,
        stale: gameTitlesHasError && resourceQueries.gameTitlesQuery.data !== undefined,
      },
      map: {
        completion: completions[`map:${viewModel.selectedGameTitleId}`],
        create: {
          action: createActions.mapCreateAction,
          error: createActions.mapCreateState.error,
          formKey: createActions.mapCreateState.version,
          pending: createActions.mapCreatePending,
        },
        error: mapMastersHasError ? mapError : undefined,
        hasData: mapMastersHasData,
        items: viewModel.selectedMapMasters,
        loadFailed: mapMastersHasError && !mapMastersHasData,
        loading: isInitialQueryLoading(resourceQueries.mapMastersQuery) && !mapMastersHasError,
        onDelete: editCommands.deleteMapMaster,
        onRetry: () => void resourceQueries.mapMastersQuery.refetch(),
        onUpdate: editCommands.updateMapMaster,
        retrying: resourceQueries.mapMastersQuery.isFetching && !hasPendingMutation,
        stale: mapMastersHasError && mapMastersHasData,
      },
      scopedDisabledReason: viewModel.scopedDisabledReason,
      season: {
        completion: completions[`season:${viewModel.selectedGameTitleId}`],
        create: {
          action: createActions.seasonCreateAction,
          error: createActions.seasonCreateState.error,
          formKey: createActions.seasonCreateState.version,
          pending: createActions.seasonCreatePending,
        },
        error: seasonMastersHasError ? seasonError : undefined,
        hasData: seasonMastersHasData,
        items: viewModel.selectedSeasonMasters,
        loadFailed: seasonMastersHasError && !seasonMastersHasData,
        loading:
          isInitialQueryLoading(resourceQueries.seasonMastersQuery) && !seasonMastersHasError,
        onDelete: editCommands.deleteSeasonMaster,
        onRetry: () => void resourceQueries.seasonMastersQuery.refetch(),
        onUpdate: editCommands.updateSeasonMaster,
        retrying: resourceQueries.seasonMastersQuery.isFetching && !hasPendingMutation,
        stale: seasonMastersHasError && seasonMastersHasData,
      },
    },
    feedback: {
      authError: auth.error,
      invalidReturnTo: returnRoute.hasInvalidReturnTo,
      operationError,
    },
    incidents: {
      hasData: resourceQueries.incidentMastersQuery.data !== undefined,
      loadFailed:
        incidentMastersHasError && resourceQueries.incidentMastersQuery.data === undefined,
      items: resourceQueries.incidentMasters,
      onRetry: async () => (await resourceQueries.incidentMastersQuery.refetch()).isSuccess,
      refreshing: resourceQueries.incidentMastersQuery.isFetching,
      stale: incidentMastersHasError && resourceQueries.incidentMastersQuery.data !== undefined,
    },
    navigation: {
      disabled:
        hasPendingMutation ||
        notifications.pending ||
        accounts.pending ||
        isReturnNavigationPending,
      disabledReason: isReturnNavigationPending
        ? "元の入力画面へ移動しています。"
        : hasPendingMutation || notifications.pending || accounts.pending
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
    notifications,
    accounts,
    tabs: {
      active: activeTab,
      items: masterTabs,
      onChange: setActiveTab,
    },
  };
}
