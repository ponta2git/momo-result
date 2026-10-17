import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type {
  OptimisticGameTitle,
  OptimisticMapMaster,
  OptimisticSeasonMaster,
} from "@/features/masters/catalog/catalogTypes";
import { defaultLayoutFamily } from "@/features/masters/catalog/catalogValidation";
import { useMasterCatalogCreateActions } from "@/features/masters/catalog/useMasterCatalogCreateActions";
import { useMasterCatalogMutations } from "@/features/masters/catalog/useMasterCatalogMutations";
import { useMasterCatalogQueries } from "@/features/masters/catalog/useMasterCatalogQueries";
import { useMasterOptimisticCatalog } from "@/features/masters/catalog/useMasterOptimisticCatalog";
import {
  masterDirectoryState,
  masterResourceErrorMessage,
} from "@/features/masters/masterDirectoryState";
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
  const { selection } = optimisticCatalog;

  const createActions = useMasterCatalogCreateActions({
    onFeedback,
    addOptimisticGameTitle: optimisticCatalog.addOptimisticGameTitle,
    addOptimisticMapMaster: optimisticCatalog.addOptimisticMapMaster,
    addOptimisticSeasonMaster: optimisticCatalog.addOptimisticSeasonMaster,
    idempotencyKeys,
    nowIsoFactory,
    optimisticGameTitleCount: optimisticCatalog.optimisticGameTitles.length,
    queryClient,
    selectedMapMasterCount: selection.selectedMapMasters.length,
    selectedSeasonMasterCount: selection.selectedSeasonMasters.length,
    onGameTitleCreated: setSelectedGameTitleId,
    selectedGameTitleId: selection.selectedGameTitleId,
  });

  const mutations = useMasterCatalogMutations({
    onFeedback,
    idempotencyKeys,
    queryClient,
    selectedGameTitleId: selection.selectedGameTitleId,
    onGameTitleDeleted: (id) =>
      setSelectedGameTitleId((current) => (current === id ? "" : current)),
  });

  const hasPendingMutation =
    (admin.retained && createActions.gameTitleCreatePending) ||
    (operations.retained &&
      (createActions.mapCreatePending || createActions.seasonCreatePending || mutations.pending));
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
  const mapItems: readonly OptimisticMapMaster[] = selection.selectedMapMasters;
  const seasonItems: readonly OptimisticSeasonMaster[] = selection.selectedSeasonMasters;

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
        onDelete: mutations.deleteGameTitle,
        onRetry: async () =>
          Boolean(authorization.begin("operations")) &&
          (await resourceQueries.gameTitlesQuery.refetch()).isSuccess,
        onSelect: (id: string) => setSelectedGameTitleId(id),
        onUpdate: mutations.updateGameTitle,
        selectedId: selection.selectedGameTitleId,
      },
      map: {
        ...mapState,
        completion: completions[`map:${selection.selectedGameTitleId}`],
        create: {
          scopeKey: selection.selectedGameTitleId,
          action: createActions.mapCreateAction,
          error: createActions.mapCreateState.error,
          formKey: createActions.mapCreateState.version,
          pending: createActions.mapCreatePending,
        },
        error: mapMastersHasError ? mapError : undefined,
        items: mapItems,
        onDelete: mutations.deleteMapMaster,
        onRetry: () => {
          if (authorization.begin("operations")) void resourceQueries.mapMastersQuery.refetch();
        },
        onUpdate: mutations.updateMapMaster,
        retrying: mapState.refreshing,
      },
      scopedDisabledReason: selection.scopedDisabledReason,
      season: {
        ...seasonState,
        completion: completions[`season:${selection.selectedGameTitleId}`],
        create: {
          scopeKey: selection.selectedGameTitleId,
          action: createActions.seasonCreateAction,
          error: createActions.seasonCreateState.error,
          formKey: createActions.seasonCreateState.version,
          pending: createActions.seasonCreatePending,
        },
        error: seasonMastersHasError ? seasonError : undefined,
        items: seasonItems,
        onDelete: mutations.deleteSeasonMaster,
        onRetry: () => {
          if (authorization.begin("operations")) void resourceQueries.seasonMastersQuery.refetch();
        },
        onUpdate: mutations.updateSeasonMaster,
        retrying: seasonState.refreshing,
      },
    },
    pending: hasPendingMutation,
    operationError: mutations.operationError,
  } as const;
}
