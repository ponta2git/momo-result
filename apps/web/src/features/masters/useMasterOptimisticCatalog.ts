import { useMemo, useOptimistic } from "react";

import { buildMasterViewModel } from "@/features/masters/masterViewModel";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

export type OptimisticGameTitle = GameTitleResponse & { pending?: boolean };
export type OptimisticMapMaster = MapMasterResponse & { pending?: boolean };
export type OptimisticSeasonMaster = SeasonMasterResponse & { pending?: boolean };

function appendOptimisticItem<T extends { id: string }>(state: T[], item: T): T[] {
  return state.some((current) => current.id === item.id) ? state : [...state, item];
}

export function useMasterOptimisticCatalog(input: {
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

  const viewModel = useMemo(
    () =>
      buildMasterViewModel({
        gameTitles: optimisticGameTitles,
        mapMasters: optimisticMapMasters,
        seasonMasters: optimisticSeasonMasters,
        selectedGameTitleId: input.selectedGameTitleId,
      }),
    [
      input.selectedGameTitleId,
      optimisticGameTitles,
      optimisticMapMasters,
      optimisticSeasonMasters,
    ],
  );

  return {
    addOptimisticGameTitle,
    addOptimisticMapMaster,
    addOptimisticSeasonMaster,
    optimisticGameTitles,
    optimisticMapMasters,
    optimisticSeasonMasters,
    viewModel,
  };
}
