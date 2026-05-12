import type { IdempotencyRequestOptions } from "@/shared/api/client";
import {
  createGameTitle,
  createMapMaster,
  createMemberAlias,
  createSeasonMaster,
  deleteGameTitle,
  deleteMapMaster,
  deleteMemberAlias,
  deleteSeasonMaster,
  listGameTitles,
  listIncidentMasters,
  listMapMasters,
  listMemberAliases,
  listSeasonMasters,
  updateGameTitle,
  updateMapMaster,
  updateMemberAlias,
  updateSeasonMaster,
} from "@/shared/api/masters";
import type {
  CreateGameTitleRequest,
  CreateMapMasterRequest,
  CreateMemberAliasRequest,
  CreateSeasonMasterRequest,
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  MemberAliasResponse,
  SeasonMasterResponse,
  UpdateGameTitleRequest,
  UpdateMapMasterRequest,
  UpdateMemberAliasRequest,
  UpdateSeasonMasterRequest,
} from "@/shared/api/masters";
import { masterKeys } from "@/shared/api/queryKeys";

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

function byMemberAlias(a: MemberAliasResponse, b: MemberAliasResponse): number {
  if (a.memberId !== b.memberId) {
    return a.memberId.localeCompare(b.memberId);
  }
  return a.alias.localeCompare(b.alias, "ja");
}

export const masterQueryKeys = {
  gameTitles: masterKeys.gameTitles.adminList,
  incidentMasters: masterKeys.incidentMasters.adminList,
  mapMasters: masterKeys.mapMasters.adminList,
  memberAliases: masterKeys.memberAliases.adminList,
  seasonMasters: masterKeys.seasonMasters.adminList,
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

export async function fetchMemberAliases(): Promise<MemberAliasResponse[]> {
  const response = await listMemberAliases();
  return (response.items ?? []).toSorted(byMemberAlias);
}

export function postGameTitle(
  request: CreateGameTitleRequest,
  options: IdempotencyRequestOptions = {},
) {
  return createGameTitle(request, options);
}

export function postMapMaster(
  request: CreateMapMasterRequest,
  options: IdempotencyRequestOptions = {},
) {
  return createMapMaster(request, options);
}

export function postSeasonMaster(
  request: CreateSeasonMasterRequest,
  options: IdempotencyRequestOptions = {},
) {
  return createSeasonMaster(request, options);
}

export function patchGameTitle(id: string, request: UpdateGameTitleRequest) {
  return updateGameTitle(id, request);
}

export function removeGameTitle(id: string) {
  return deleteGameTitle(id);
}

export function patchMapMaster(id: string, request: UpdateMapMasterRequest) {
  return updateMapMaster(id, request);
}

export function removeMapMaster(id: string) {
  return deleteMapMaster(id);
}

export function patchSeasonMaster(id: string, request: UpdateSeasonMasterRequest) {
  return updateSeasonMaster(id, request);
}

export function removeSeasonMaster(id: string) {
  return deleteSeasonMaster(id);
}

export function postMemberAlias(
  request: CreateMemberAliasRequest,
  options: IdempotencyRequestOptions = {},
) {
  return createMemberAlias(request, options);
}

export function patchMemberAlias(id: string, request: UpdateMemberAliasRequest) {
  return updateMemberAlias(id, request);
}

export function removeMemberAlias(id: string) {
  return deleteMemberAlias(id);
}
