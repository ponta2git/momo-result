import { useCallback, useState } from "react";

import type { MasterCatalogView } from "@/features/masters/catalog/catalogTypes";
import { defaultLayoutFamily } from "@/features/masters/catalog/catalogValidation";
import { useMasterCatalogCreateActions } from "@/features/masters/catalog/useMasterCatalogCreateActions";
import { useMasterCatalogEdits } from "@/features/masters/catalog/useMasterCatalogEdits";
import { useMasterCatalogResource } from "@/features/masters/catalog/useMasterCatalogResource";
import { useMasterOptimisticCatalog } from "@/features/masters/catalog/useMasterOptimisticCatalog";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { usePermissionFacts } from "@/shared/auth/useAuthorization";

/** Owns the selected title and its related catalog, including optimistic and confirmed changes. */
export function useMasterCatalog(enabled: boolean) {
  const admin = usePermissionFacts("admin");
  const operations = usePermissionFacts("operations");
  const idempotencyKeys = useIdempotencyKeyStore();
  const readNowIso = useCallback(() => new Date().toISOString(), []);
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
    readNowIso,
    optimisticGameTitleCount: optimisticCatalog.optimisticGameTitles.length,
    selectedMapMasterCount: selection.selectedMapMasters.length,
    selectedSeasonMasterCount: selection.selectedSeasonMasters.length,
    onGameTitleCreated: setSelectedGameTitleId,
    selectedGameTitleId: selection.selectedGameTitleId,
  });

  const edits = useMasterCatalogEdits({
    onFeedback,
    idempotencyKeys,
    selectedGameTitleId: selection.selectedGameTitleId,
    onGameTitleDeleted: (id) =>
      setSelectedGameTitleId((current) => (current === id ? "" : current)),
  });

  const hasPendingMutation =
    (admin.retained && createActions.gameTitleCreatePending) ||
    (operations.retained &&
      (createActions.mapCreatePending || createActions.seasonCreatePending || edits.pending));
  const catalog: MasterCatalogView = {
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
      items: optimisticCatalog.optimisticGameTitles,
      onDelete: edits.deleteGameTitle,
      onRetry: refreshGameTitles,
      onSelect: setSelectedGameTitleId,
      onUpdate: edits.updateGameTitle,
      selectedGameTitleId: selection.selectedGameTitleId,
    },
    map: {
      actions: {
        onDelete: edits.deleteMapMaster,
        onUpdate: edits.updateMapMaster,
      },
      create: {
        scopeKey: selection.selectedGameTitleId,
        action: createActions.mapCreateAction,
        error: createActions.mapCreateState.error,
        formKey: createActions.mapCreateState.version,
        pending: createActions.mapCreatePending,
      },
      list: {
        ...mapMasters,
        completion: completions[`map:${selection.selectedGameTitleId}`],
        items: selection.selectedMapMasters,
        onRetry: refreshMapMasters,
        retrying: mapMasters.refreshing && !hasPendingMutation,
      },
    },
    scopedDisabledReason: selection.scopedDisabledReason,
    season: {
      actions: {
        onDelete: edits.deleteSeasonMaster,
        onUpdate: edits.updateSeasonMaster,
      },
      create: {
        scopeKey: selection.selectedGameTitleId,
        action: createActions.seasonCreateAction,
        error: createActions.seasonCreateState.error,
        formKey: createActions.seasonCreateState.version,
        pending: createActions.seasonCreatePending,
      },
      list: {
        ...seasonMasters,
        completion: completions[`season:${selection.selectedGameTitleId}`],
        items: selection.selectedSeasonMasters,
        onRetry: refreshSeasonMasters,
        retrying: seasonMasters.refreshing && !hasPendingMutation,
      },
    },
  };

  return {
    catalog,
    pending: hasPendingMutation,
    operationError: edits.operationError,
  } as const;
}
