import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { defaultLayoutFamily } from "@/features/masters/masterValidation";
import {
  masterDirectoryState,
  masterResourceErrorMessage,
} from "@/features/masters/masterViewModel";
import { useMasterCreateActions } from "@/features/masters/useMasterCreateActions";
import { useMasterEditCommands } from "@/features/masters/useMasterEditCommands";
import { useMasterOptimisticCatalog } from "@/features/masters/useMasterOptimisticCatalog";
import { useMasterResourceQueries } from "@/features/masters/useMasterResourceQueries";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useAuthorization } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Owns master directory selection, optimistic changes, and their read/command lifecycles. */
export function useMasterDirectories(enabled: {
  catalog: boolean;
  aliases: boolean;
  incidents: boolean;
}) {
  const authorization = useAuthorization();
  const { auth } = authorization;
  const authScope = auth.auth?.accountId ?? "anonymous";
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const [selectedGameTitleId, setSelectedGameTitleId] = useState("");
  const [completions, setCompletions] = useState<Record<string, string>>({});
  const onFeedback = useCallback((kind: string, scope: string, message: string) => {
    setCompletions((current) => ({ ...current, [`${kind}:${scope}`]: message }));
  }, []);
  const [operationError, setOperationError] = useState<string>();

  const resourceQueries = useMasterResourceQueries(selectedGameTitleId, {
    catalog: authorization.allowed.operations && enabled.catalog,
    aliases: authorization.allowed.admin && enabled.aliases,
    incidents: authorization.allowed.operations && enabled.incidents,
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
    (authorization.retained.admin &&
      (createActions.gameTitleCreatePending || createActions.aliasCreatePending)) ||
    (authorization.retained.operations &&
      (createActions.mapCreatePending ||
        createActions.seasonCreatePending ||
        editCommands.editPending));
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

  return {
    aliases: {
      ...masterDirectoryState({
        hasData: resourceQueries.memberAliasesQuery.data !== undefined,
        failed: memberAliasesHasError,
        initialLoading: isInitialQueryLoading(resourceQueries.memberAliasesQuery),
        fetching: resourceQueries.memberAliasesQuery.isFetching,
        mutationPending: hasPendingMutation,
      }),
      completion: completions["aliases:"],
      createAction: createActions.aliasCreateAction,
      createError: createActions.aliasCreateState.error,
      createFormKey: createActions.aliasCreateState.version,
      createPending: createActions.aliasCreatePending,
      items: resourceQueries.memberAliases,
      onDelete: editCommands.deleteMemberAlias,
      onRetry: async () =>
        Boolean(authorization.begin("admin")) &&
        (await resourceQueries.memberAliasesQuery.refetch()).isSuccess,
      onUpdate: editCommands.updateMemberAlias,
    },
    catalog: {
      gameTitle: {
        ...masterDirectoryState({
          hasData: resourceQueries.gameTitlesQuery.data !== undefined,
          failed: gameTitlesHasError,
          initialLoading: isInitialQueryLoading(resourceQueries.gameTitlesQuery),
          fetching: resourceQueries.gameTitlesQuery.isFetching,
          mutationPending: hasPendingMutation,
        }),
        canEdit: authorization.retained.admin,
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
        onRetry: async () =>
          Boolean(authorization.begin("operations")) &&
          (await resourceQueries.gameTitlesQuery.refetch()).isSuccess,
        onSelect: setSelectedGameTitleId,
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
        items: viewModel.selectedMapMasters,
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
        items: viewModel.selectedSeasonMasters,
        onDelete: editCommands.deleteSeasonMaster,
        onRetry: () => {
          if (authorization.begin("operations")) void resourceQueries.seasonMastersQuery.refetch();
        },
        onUpdate: editCommands.updateSeasonMaster,
        retrying: seasonState.refreshing,
      },
    },
    incidents: {
      ...masterDirectoryState({
        hasData: resourceQueries.incidentMastersQuery.data !== undefined,
        failed: incidentMastersHasError,
        initialLoading: isInitialQueryLoading(resourceQueries.incidentMastersQuery),
        fetching: resourceQueries.incidentMastersQuery.isFetching,
        mutationPending: false,
      }),
      items: resourceQueries.incidentMasters,
      onRetry: async () =>
        Boolean(authorization.begin("operations")) &&
        (await resourceQueries.incidentMastersQuery.refetch()).isSuccess,
    },
    pending: hasPendingMutation,
    operationError,
  };
}
