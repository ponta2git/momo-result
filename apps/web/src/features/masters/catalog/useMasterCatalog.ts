import { useCallback, useState } from "react";

import type {
  OptimisticGameTitle,
  OptimisticMapMaster,
  OptimisticSeasonMaster,
} from "@/features/masters/catalog/catalogTypes";
import { defaultLayoutFamily } from "@/features/masters/catalog/catalogValidation";
import { useMasterCatalogCreateActions } from "@/features/masters/catalog/useMasterCatalogCreateActions";
import { useMasterCatalogMutations } from "@/features/masters/catalog/useMasterCatalogMutations";
import { useMasterCatalogResource } from "@/features/masters/catalog/useMasterCatalogResource";
import { useMasterOptimisticCatalog } from "@/features/masters/catalog/useMasterOptimisticCatalog";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { usePermissionFacts } from "@/shared/auth/useAuthorization";

/** Owns the selected title and its related catalog, including optimistic and confirmed changes. */
export function useMasterCatalog(enabled: boolean) {
  const admin = usePermissionFacts("admin");
  const operations = usePermissionFacts("operations");
  const idempotencyKeys = useIdempotencyKeyStore();
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const [selectedGameTitleId, setSelectedGameTitleId] = useState("");
  const [completions, setCompletions] = useState<Record<string, string>>({});
  const onFeedback = useCallback((kind: string, scope: string, message: string) => {
    setCompletions((current) => ({ ...current, [`${kind}:${scope}`]: message }));
  }, []);

  const resource = useMasterCatalogResource(selectedGameTitleId, operations.allowed && enabled);
  const { refresh: refreshGameTitles, ...gameTitles } = resource.gameTitles;
  const { refresh: refreshMapMasters, ...mapMasters } = resource.mapMasters;
  const { refresh: refreshSeasonMasters, ...seasonMasters } = resource.seasonMasters;
  const optimisticCatalog = useMasterOptimisticCatalog({
    fallbackSelectedGameTitleId: resource.selectedGameTitleId,
    gameTitles: gameTitles.items,
    mapMasters: mapMasters.items,
    seasonMasters: seasonMasters.items,
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
    selectedMapMasterCount: selection.selectedMapMasters.length,
    selectedSeasonMasterCount: selection.selectedSeasonMasters.length,
    onGameTitleCreated: setSelectedGameTitleId,
    selectedGameTitleId: selection.selectedGameTitleId,
  });

  const mutations = useMasterCatalogMutations({
    onFeedback,
    idempotencyKeys,
    selectedGameTitleId: selection.selectedGameTitleId,
    onGameTitleDeleted: (id) =>
      setSelectedGameTitleId((current) => (current === id ? "" : current)),
  });

  const hasPendingMutation =
    (admin.retained && createActions.gameTitleCreatePending) ||
    (operations.retained &&
      (createActions.mapCreatePending || createActions.seasonCreatePending || mutations.pending));
  const gameTitleItems: readonly OptimisticGameTitle[] = optimisticCatalog.optimisticGameTitles;
  const mapItems: readonly OptimisticMapMaster[] = selection.selectedMapMasters;
  const seasonItems: readonly OptimisticSeasonMaster[] = selection.selectedSeasonMasters;

  return {
    catalog: {
      gameTitle: {
        ...gameTitles,
        refreshing: gameTitles.refreshing && !hasPendingMutation,
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
        onRetry: refreshGameTitles,
        onSelect: (id: string) => setSelectedGameTitleId(id),
        onUpdate: mutations.updateGameTitle,
        selectedId: selection.selectedGameTitleId,
      },
      map: {
        ...mapMasters,
        refreshing: mapMasters.refreshing && !hasPendingMutation,
        completion: completions[`map:${selection.selectedGameTitleId}`],
        create: {
          scopeKey: selection.selectedGameTitleId,
          action: createActions.mapCreateAction,
          error: createActions.mapCreateState.error,
          formKey: createActions.mapCreateState.version,
          pending: createActions.mapCreatePending,
        },
        items: mapItems,
        onDelete: mutations.deleteMapMaster,
        onRetry: refreshMapMasters,
        onUpdate: mutations.updateMapMaster,
        retrying: mapMasters.refreshing && !hasPendingMutation,
      },
      scopedDisabledReason: selection.scopedDisabledReason,
      season: {
        ...seasonMasters,
        refreshing: seasonMasters.refreshing && !hasPendingMutation,
        completion: completions[`season:${selection.selectedGameTitleId}`],
        create: {
          scopeKey: selection.selectedGameTitleId,
          action: createActions.seasonCreateAction,
          error: createActions.seasonCreateState.error,
          formKey: createActions.seasonCreateState.version,
          pending: createActions.seasonCreatePending,
        },
        items: seasonItems,
        onDelete: mutations.deleteSeasonMaster,
        onRetry: refreshSeasonMasters,
        onUpdate: mutations.updateSeasonMaster,
        retrying: seasonMasters.refreshing && !hasPendingMutation,
      },
    },
    pending: hasPendingMutation,
    operationError: mutations.operationError,
  } as const;
}
