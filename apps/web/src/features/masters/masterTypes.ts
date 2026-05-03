import type {
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

export type ScopedMasterKind = "map" | "season";

export type GameTitleDraft = {
  layoutFamily: string;
  name: string;
};

export type ScopedMasterDraft = {
  name: string;
};

export type MasterRecord = {
  id: string;
  name: string;
};

export type IncidentMasterRecord = {
  displayName: string;
  displayOrder: number;
  id: string;
  key: string;
};

export type MasterViewModelInput = {
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  selectedGameTitleId: string;
};

export type MasterViewModel = {
  canCreateScopedMasters: boolean;
  scopedDisabledReason?: string;
  selectedGameTitle?: GameTitleResponse;
  selectedGameTitleId: string;
  selectedMapMasters: MapMasterResponse[];
  selectedSeasonMasters: SeasonMasterResponse[];
  shouldPromptGameTitleCreation: boolean;
};

export type MasterLists = {
  gameTitles: GameTitleResponse[];
  incidentMasters: IncidentMasterResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
};
