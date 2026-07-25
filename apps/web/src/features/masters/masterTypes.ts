import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

export type MasterViewModelInput = {
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
};

export type MasterViewModel = {
  canCreateScopedMasters: boolean;
  scopedDisabledReason: string | undefined;
  selectedGameTitle: GameTitleResponse | undefined;
  selectedGameTitleId: string;
  selectedMapMasters: MapMasterResponse[];
  selectedSeasonMasters: SeasonMasterResponse[];
  shouldPromptGameTitleCreation: boolean;
};
