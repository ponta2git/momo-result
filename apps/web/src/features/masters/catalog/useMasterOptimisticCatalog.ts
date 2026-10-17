import { useMemo, useOptimistic } from "react";

import {
  selectMasterCatalog,
  resolveMasterSelectionId,
} from "@/features/masters/catalog/catalogPresentation";
import type {
  OptimisticGameTitle,
  OptimisticMapMaster,
  OptimisticSeasonMaster,
} from "@/features/masters/catalog/catalogTypes";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

function appendOptimisticItem<T extends { id: string }>(state: T[], item: T): T[] {
  return state.some((current) => current.id === item.id) ? state : [...state, item];
}

export function useMasterOptimisticCatalog(input: {
  fallbackSelectedGameTitleId: string;
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
}) {
  const [optimisticGameTitles, addOptimisticGameTitle] = useOptimistic<
    OptimisticGameTitle[],
    OptimisticGameTitle
  >(input.gameTitles, appendOptimisticItem);

  const [optimisticMapMasters, addOptimisticMapMaster] = useOptimistic<
    OptimisticMapMaster[],
    OptimisticMapMaster
  >(input.mapMasters, appendOptimisticItem);

  const [optimisticSeasonMasters, addOptimisticSeasonMaster] = useOptimistic<
    OptimisticSeasonMaster[],
    OptimisticSeasonMaster
  >(input.seasonMasters, appendOptimisticItem);
  const selectedGameTitleId = resolveMasterSelectionId(
    optimisticGameTitles,
    input.selectedGameTitleId,
    input.fallbackSelectedGameTitleId,
  );

  const selection = useMemo(
    () =>
      selectMasterCatalog({
        gameTitles: optimisticGameTitles,
        mapMasters: optimisticMapMasters,
        seasonMasters: optimisticSeasonMasters,
        selectedGameTitleId,
      }),
    [optimisticGameTitles, optimisticMapMasters, optimisticSeasonMasters, selectedGameTitleId],
  );

  return {
    addOptimisticGameTitle,
    addOptimisticMapMaster,
    addOptimisticSeasonMaster,
    optimisticGameTitles,
    optimisticMapMasters,
    optimisticSeasonMasters,
    selection,
  };
}
