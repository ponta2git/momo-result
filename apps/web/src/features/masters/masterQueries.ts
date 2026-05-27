import type { ApiSignalOptions } from "@/shared/api/client";
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

export async function fetchGameTitles(
  options: ApiSignalOptions = {},
): Promise<GameTitleResponse[]> {
  const response = await listGameTitles(options);
  return (response.items ?? []).toSorted(byDisplayOrder);
}

export async function fetchMapMasters(
  gameTitleId: string,
  options: ApiSignalOptions = {},
): Promise<MapMasterResponse[]> {
  if (!gameTitleId) {
    return [];
  }
  const response = await listMapMasters(gameTitleId, options);
  return (response.items ?? []).toSorted(byDisplayOrder);
}

export async function fetchSeasonMasters(
  gameTitleId: string,
  options: ApiSignalOptions = {},
): Promise<SeasonMasterResponse[]> {
  if (!gameTitleId) {
    return [];
  }
  const response = await listSeasonMasters(gameTitleId, options);
  return (response.items ?? []).toSorted(byDisplayOrder);
}

export async function fetchIncidentMasters(
  options: ApiSignalOptions = {},
): Promise<IncidentMasterResponse[]> {
  const response = await listIncidentMasters(options);
  return (response.items ?? []).toSorted(byIncidentOrder);
}

export async function fetchMemberAliases(
  options: ApiSignalOptions = {},
): Promise<MemberAliasResponse[]> {
  const response = await listMemberAliases(undefined, options);
  return (response.items ?? []).toSorted(byMemberAlias);
}
