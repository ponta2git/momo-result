import { apiRequest } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type GameTitleResponse = components["schemas"]["GameTitleResponse"];
export type GameTitleListResponse = components["schemas"]["GameTitleListResponse"];
export type CreateGameTitleRequest = components["schemas"]["CreateGameTitleRequest"];

export type MapMasterResponse = components["schemas"]["MapMasterResponse"];
export type MapMasterListResponse = components["schemas"]["MapMasterListResponse"];
export type CreateMapMasterRequest = components["schemas"]["CreateMapMasterRequest"];

export type SeasonMasterResponse = components["schemas"]["SeasonMasterResponse"];
export type SeasonMasterListResponse = components["schemas"]["SeasonMasterListResponse"];
export type CreateSeasonMasterRequest = components["schemas"]["CreateSeasonMasterRequest"];

export type IncidentMasterResponse = components["schemas"]["IncidentMasterResponse"];
export type IncidentMasterListResponse = components["schemas"]["IncidentMasterListResponse"];

export async function listGameTitles(): Promise<GameTitleListResponse> {
  return apiRequest<GameTitleListResponse>("/api/game-titles");
}

export async function createGameTitle(request: CreateGameTitleRequest): Promise<GameTitleResponse> {
  return apiRequest<GameTitleResponse>("/api/game-titles", {
    method: "POST",
    body: request,
  });
}

export async function listMapMasters(gameTitleId?: string): Promise<MapMasterListResponse> {
  const path = gameTitleId
    ? `/api/map-masters?gameTitleId=${encodeURIComponent(gameTitleId)}`
    : "/api/map-masters";
  return apiRequest<MapMasterListResponse>(path);
}

export async function createMapMaster(request: CreateMapMasterRequest): Promise<MapMasterResponse> {
  return apiRequest<MapMasterResponse>("/api/map-masters", {
    method: "POST",
    body: request,
  });
}

export async function listSeasonMasters(gameTitleId?: string): Promise<SeasonMasterListResponse> {
  const path = gameTitleId
    ? `/api/season-masters?gameTitleId=${encodeURIComponent(gameTitleId)}`
    : "/api/season-masters";
  return apiRequest<SeasonMasterListResponse>(path);
}

export async function createSeasonMaster(
  request: CreateSeasonMasterRequest,
): Promise<SeasonMasterResponse> {
  return apiRequest<SeasonMasterResponse>("/api/season-masters", {
    method: "POST",
    body: request,
  });
}

export async function listIncidentMasters(): Promise<IncidentMasterListResponse> {
  return apiRequest<IncidentMasterListResponse>("/api/incident-masters");
}
