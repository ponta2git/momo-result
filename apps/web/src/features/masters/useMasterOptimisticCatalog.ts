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

export function useMasterOptimisticCatalog(input: {
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
}) {
  const [optimisticGameTitles, addOptimisticGameTitle] = useOptimistic<
    OptimisticGameTitle[],
    OptimisticGameTitle
  >(input.gameTitles, (state, item) => [...state, item]);

  const [optimisticMapMasters, addOptimisticMapMaster] = useOptimistic<
    OptimisticMapMaster[],
    OptimisticMapMaster
  >(input.mapMasters, (state, item) => [...state, item]);

  const [optimisticSeasonMasters, addOptimisticSeasonMaster] = useOptimistic<
    OptimisticSeasonMaster[],
    OptimisticSeasonMaster
  >(input.seasonMasters, (state, item) => [...state, item]);

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
