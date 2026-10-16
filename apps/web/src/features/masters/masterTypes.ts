import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

export type OptimisticGameTitle = GameTitleResponse & { pending?: boolean };
export type OptimisticMapMaster = MapMasterResponse & { pending?: boolean };
export type OptimisticSeasonMaster = SeasonMasterResponse & { pending?: boolean };

export type MasterViewModelInput = {
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
};
