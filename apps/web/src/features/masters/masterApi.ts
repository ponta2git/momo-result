import {
  createGameTitle,
  createMapMaster,
  createSeasonMaster,
  listGameTitles,
  listIncidentMasters,
  listMapMasters,
  listSeasonMasters,
} from "@/shared/api/masters";
import type {
  CreateGameTitleRequest,
  CreateMapMasterRequest,
  CreateSeasonMasterRequest,
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

function byDisplayOrder<T extends { displayOrder: number; name: string }>(a: T, b: T): number {
  if (a.displayOrder !== b.displayOrder) {
    return a.displayOrder - b.displayOrder;
  }
  return a.name.localeCompare(b.name, "ja");
}

function byIncidentOrder(a: IncidentMasterResponse, b: IncidentMasterResponse): number {
  if (a.displayOrder !== b.displayOrder) {
    return a.displayOrder - b.displayOrder;
  }
  return a.displayName.localeCompare(b.displayName, "ja");
}

export const masterQueryKeys = {
  gameTitles: (authScope: string) => ["masters-admin", "game-titles", authScope] as const,
  incidentMasters: (authScope: string) => ["masters-admin", "incident-masters", authScope] as const,
  mapMasters: (authScope: string, gameTitleId: string) =>
    ["masters-admin", "map-masters", authScope, gameTitleId || "none"] as const,
  seasonMasters: (authScope: string, gameTitleId: string) =>
    ["masters-admin", "season-masters", authScope, gameTitleId || "none"] as const,
};

export async function fetchGameTitles(): Promise<GameTitleResponse[]> {
  const response = await listGameTitles();
  return (response.items ?? []).toSorted(byDisplayOrder);
}

export async function fetchMapMasters(gameTitleId: string): Promise<MapMasterResponse[]> {
  if (!gameTitleId) {
    return [];
  }
  const response = await listMapMasters(gameTitleId);
  return (response.items ?? []).toSorted(byDisplayOrder);
}

export async function fetchSeasonMasters(gameTitleId: string): Promise<SeasonMasterResponse[]> {
  if (!gameTitleId) {
    return [];
  }
  const response = await listSeasonMasters(gameTitleId);
  return (response.items ?? []).toSorted(byDisplayOrder);
}

export async function fetchIncidentMasters(): Promise<IncidentMasterResponse[]> {
  const response = await listIncidentMasters();
  return (response.items ?? []).toSorted(byIncidentOrder);
}

export function postGameTitle(request: CreateGameTitleRequest) {
  return createGameTitle(request);
}

export function postMapMaster(request: CreateMapMasterRequest) {
  return createMapMaster(request);
}

export function postSeasonMaster(request: CreateSeasonMasterRequest) {
  return createSeasonMaster(request);
}
