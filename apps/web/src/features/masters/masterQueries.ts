import {
  listGameTitles,
  listIncidentMasters,
  listMapMasters,
  listMemberAliases,
  listSeasonMasters,
} from "@/shared/api/masters";
import type {
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  MemberAliasResponse,
  SeasonMasterResponse,
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
