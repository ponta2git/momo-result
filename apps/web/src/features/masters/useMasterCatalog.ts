import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type {
  OptimisticGameTitle,
  OptimisticMapMaster,
  OptimisticSeasonMaster,
} from "@/features/masters/masterTypes";
import { defaultLayoutFamily } from "@/features/masters/masterValidation";
import {
  masterDirectoryState,
  masterResourceErrorMessage,
} from "@/features/masters/masterViewModel";
import { useMasterCatalogCreateActions } from "@/features/masters/useMasterCatalogCreateActions";
import { useMasterCatalogEditCommands } from "@/features/masters/useMasterCatalogEditCommands";
import { useMasterCatalogQueries } from "@/features/masters/useMasterCatalogQueries";
import { useMasterOptimisticCatalog } from "@/features/masters/useMasterOptimisticCatalog";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Owns the selected title and its related catalog, including optimistic and confirmed changes. */
export function useMasterCatalog(enabled: boolean) {
  const authorization = useAuthorizationOperations();
  const admin = usePermissionFacts("admin");
  const operations = usePermissionFacts("operations");
  const authScope = String(operations.epoch);
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const [selectedGameTitleId, setSelectedGameTitleId] = useState("");
  const [completions, setCompletions] = useState<Record<string, string>>({});
  const onFeedback = useCallback((kind: string, scope: string, message: string) => {
    setCompletions((current) => ({ ...current, [`${kind}:${scope}`]: message }));
  }, []);

  const resourceQueries = useMasterCatalogQueries(
    selectedGameTitleId,
    operations.allowed && enabled,
  );
  const { gameTitles, mapMasters, seasonMasters } = resourceQueries;
  const optimisticCatalog = useMasterOptimisticCatalog({
    fallbackSelectedGameTitleId: resourceQueries.selectedGameTitleId,
    gameTitles,
    mapMasters,
    seasonMasters,
    selectedGameTitleId,
  });
  const { viewModel } = optimisticCatalog;

  const createActions = useMasterCatalogCreateActions({
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
    onGameTitleCreated: setSelectedGameTitleId,
    selectedGameTitleId: viewModel.selectedGameTitleId,
  });

  const editCommands = useMasterCatalogEditCommands({
    onFeedback,
    idempotencyKeys,
    queryClient,
    selectedGameTitleId: viewModel.selectedGameTitleId,
    onGameTitleDeleted: (id) =>
      setSelectedGameTitleId((current) => (current === id ? "" : current)),
  });

  const hasPendingMutation =
    (admin.retained && createActions.gameTitleCreatePending) ||
    (operations.retained &&
      (createActions.mapCreatePending ||
        createActions.seasonCreatePending ||
        editCommands.editPending));
  const gameTitlesHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.gameTitlesQuery),
    resourceQueries.gameTitlesQuery.isFetching,
    authScope,
  );
  const mapMastersHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.mapMastersQuery),
    resourceQueries.mapMastersQuery.isFetching,
    `${authScope}:${resourceQueries.selectedGameTitleId}`,
  );
  const seasonMastersHasError = useRetryNotice(
    shouldShowQueryError(resourceQueries.seasonMastersQuery),
    resourceQueries.seasonMastersQuery.isFetching,
    `${authScope}:${resourceQueries.selectedGameTitleId}`,
  );

  const mapError = useRetryNotice(
    masterResourceErrorMessage(resourceQueries.mapMastersQuery.error),
    resourceQueries.mapMastersQuery.isFetching,
    resourceQueries.selectedGameTitleId,
  );
  const seasonError = useRetryNotice(
    masterResourceErrorMessage(resourceQueries.seasonMastersQuery.error),
    resourceQueries.seasonMastersQuery.isFetching,
    resourceQueries.selectedGameTitleId,
  );
  const mapState = masterDirectoryState({
    hasData: resourceQueries.mapMastersQuery.data !== undefined,
    failed: mapMastersHasError,
    initialLoading: isInitialQueryLoading(resourceQueries.mapMastersQuery),
    fetching: resourceQueries.mapMastersQuery.isFetching,
    mutationPending: hasPendingMutation,
  });
  const seasonState = masterDirectoryState({
    hasData: resourceQueries.seasonMastersQuery.data !== undefined,
    failed: seasonMastersHasError,
    initialLoading: isInitialQueryLoading(resourceQueries.seasonMastersQuery),
    fetching: resourceQueries.seasonMastersQuery.isFetching,
    mutationPending: hasPendingMutation,
  });
  const gameTitleItems: readonly OptimisticGameTitle[] = optimisticCatalog.optimisticGameTitles;
  const mapItems: readonly OptimisticMapMaster[] = viewModel.selectedMapMasters;
  const seasonItems: readonly OptimisticSeasonMaster[] = viewModel.selectedSeasonMasters;

  return {
    catalog: {
      gameTitle: {
        ...masterDirectoryState({
          hasData: resourceQueries.gameTitlesQuery.data !== undefined,
          failed: gameTitlesHasError,
          initialLoading: isInitialQueryLoading(resourceQueries.gameTitlesQuery),
          fetching: resourceQueries.gameTitlesQuery.isFetching,
          mutationPending: hasPendingMutation,
        }),
        canEdit: admin.retained,
        completion: completions["gameTitle:"],
        create: {
          action: createActions.gameTitleCreateAction,
          error: createActions.gameTitleCreateState.error,
          formKey: createActions.gameTitleCreateState.version,
          pending: createActions.gameTitleCreatePending,
        },
        defaultLayoutFamily,
        items: gameTitleItems,
        onDelete: editCommands.deleteGameTitle,
        onRetry: async () =>
          Boolean(authorization.begin("operations")) &&
          (await resourceQueries.gameTitlesQuery.refetch()).isSuccess,
        onSelect: (id: string) => setSelectedGameTitleId(id),
        onUpdate: editCommands.updateGameTitle,
        selectedId: viewModel.selectedGameTitleId,
      },
      map: {
        ...mapState,
        completion: completions[`map:${viewModel.selectedGameTitleId}`],
        create: {
          scopeKey: viewModel.selectedGameTitleId,
          action: createActions.mapCreateAction,
          error: createActions.mapCreateState.error,
          formKey: createActions.mapCreateState.version,
          pending: createActions.mapCreatePending,
        },
        error: mapMastersHasError ? mapError : undefined,
        items: mapItems,
        onDelete: editCommands.deleteMapMaster,
        onRetry: () => {
          if (authorization.begin("operations")) void resourceQueries.mapMastersQuery.refetch();
        },
        onUpdate: editCommands.updateMapMaster,
        retrying: mapState.refreshing,
      },
      scopedDisabledReason: viewModel.scopedDisabledReason,
      season: {
        ...seasonState,
        completion: completions[`season:${viewModel.selectedGameTitleId}`],
        create: {
          scopeKey: viewModel.selectedGameTitleId,
          action: createActions.seasonCreateAction,
          error: createActions.seasonCreateState.error,
          formKey: createActions.seasonCreateState.version,
          pending: createActions.seasonCreatePending,
        },
        error: seasonMastersHasError ? seasonError : undefined,
        items: seasonItems,
        onDelete: editCommands.deleteSeasonMaster,
        onRetry: () => {
          if (authorization.begin("operations")) void resourceQueries.seasonMastersQuery.refetch();
        },
        onUpdate: editCommands.updateSeasonMaster,
        retrying: seasonState.refreshing,
      },
    },
    pending: hasPendingMutation,
    operationError: editCommands.operationError,
  } as const;
}
