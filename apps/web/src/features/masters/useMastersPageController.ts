import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useNavigate } from "react-router-dom";

import { useMasterCreateActions } from "@/features/masters/useMasterCreateActions";
import { useMasterEditCommands } from "@/features/masters/useMasterEditCommands";
import { useMasterOptimisticCatalog } from "@/features/masters/useMasterOptimisticCatalog";
import { useMasterResourceQueries } from "@/features/masters/useMasterResourceQueries";
import { useMasterReturnRoute } from "@/features/masters/useMasterReturnRoute";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useAuth } from "@/shared/auth/useAuth";

export const masterTabs = [
  { id: "catalog", label: "作品・マップ・シーズン" },
  { id: "aliases", label: "メンバー名寄せ" },
  { id: "incidents", label: "事件簿" },
] as const;

export type MasterTabId = (typeof masterTabs)[number]["id"];

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
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const [isReturnNavigationPending, startReturnTransition] = useTransition();
  const navigateWithTransition = (to: string) => {
    startReturnTransition(() => {
      navigate(to);
    });
  };

  const [selectedGameTitleId, setSelectedGameTitleId] = useState("");
  const [activeTab, setActiveTab] = useState<MasterTabId>("catalog");
  const [operationError, setOperationError] = useState<string>();
  const returnRoute = useMasterReturnRoute();

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
    createActions.aliasCreatePending;

  return {
    activeTab,
    auth,
    hasPendingMutation,
    incidentMasters: resourceQueries.incidentMasters,
    isReturnNavigationPending,
    mapMastersLoadError: shouldShowQueryError(resourceQueries.mapMastersQuery)
      ? errorMessage(resourceQueries.mapMastersQuery.error)
      : undefined,
    memberAliases: resourceQueries.memberAliases,
    navigateWithTransition,
    operationError,
    optimisticGameTitles: optimisticCatalog.optimisticGameTitles,
    seasonMastersLoadError: shouldShowQueryError(resourceQueries.seasonMastersQuery)
      ? errorMessage(resourceQueries.seasonMastersQuery.error)
      : undefined,
    selectedGameTitleId,
    setActiveTab,
    setSelectedGameTitleId,
    viewModel,
    ...createActions,
    ...editCommands,
    ...returnRoute,
  };
}
