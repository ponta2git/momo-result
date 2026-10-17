import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

export type OptimisticGameTitle = Readonly<GameTitleResponse & { pending?: boolean }>;
export type OptimisticMapMaster = Readonly<MapMasterResponse & { pending?: boolean }>;
export type OptimisticSeasonMaster = Readonly<SeasonMasterResponse & { pending?: boolean }>;

export type MasterViewModelInput = {
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
};
