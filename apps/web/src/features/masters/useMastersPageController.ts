import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

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

export function useMastersPageController() {
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
  const returnRoute = useMasterReturnRoute();

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
    activeTab,
    auth,
    gameTitlesRefreshing: resourceQueries.gameTitlesQuery.isFetching,
    gameTitlesStale: gameTitlesHasError && resourceQueries.gameTitlesQuery.data !== undefined,
    hasPendingMutation,
    incidentMasters: resourceQueries.incidentMasters,
    incidentMastersRefreshing: resourceQueries.incidentMastersQuery.isFetching,
    incidentMastersStale:
      incidentMastersHasError && resourceQueries.incidentMastersQuery.data !== undefined,
    isReturnNavigationPending,
    mapMastersHasData,
    mapMastersLoadFailed: shouldShowBlockingQueryError(resourceQueries.mapMastersQuery),
    mapMastersLoading: isInitialQueryLoading(resourceQueries.mapMastersQuery),
    mapMastersLoadError: mapMastersHasError
      ? errorMessage(resourceQueries.mapMastersQuery.error)
      : undefined,
    mapMastersRefreshing: resourceQueries.mapMastersQuery.isFetching,
    mapMastersStale: mapMastersHasError && mapMastersHasData,
    memberAliasesRefreshing: resourceQueries.memberAliasesQuery.isFetching,
    memberAliasesStale:
      memberAliasesHasError && resourceQueries.memberAliasesQuery.data !== undefined,
    retryGameTitles: () => void resourceQueries.gameTitlesQuery.refetch(),
    retryIncidentMasters: () => void resourceQueries.incidentMastersQuery.refetch(),
    retryMapMasters: () => void resourceQueries.mapMastersQuery.refetch(),
    memberAliases: resourceQueries.memberAliases,
    navigateWithTransition,
    operationError,
    optimisticGameTitles: optimisticCatalog.optimisticGameTitles,
    retryMemberAliases: () => void resourceQueries.memberAliasesQuery.refetch(),
    retrySeasonMasters: () => void resourceQueries.seasonMastersQuery.refetch(),
    seasonMastersHasData,
    seasonMastersLoadFailed: shouldShowBlockingQueryError(resourceQueries.seasonMastersQuery),
    seasonMastersLoading: isInitialQueryLoading(resourceQueries.seasonMastersQuery),
    seasonMastersLoadError: seasonMastersHasError
      ? errorMessage(resourceQueries.seasonMastersQuery.error)
      : undefined,
    seasonMastersRefreshing: resourceQueries.seasonMastersQuery.isFetching,
    seasonMastersStale: seasonMastersHasError && seasonMastersHasData,
    selectedGameTitleId,
    setActiveTab,
    setSelectedGameTitleId,
    viewModel,
    ...createActions,
    ...editCommands,
    ...returnRoute,
  };
}
