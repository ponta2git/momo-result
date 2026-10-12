import { useQuery } from "@tanstack/react-query";

import {
  selectGameTitles,
  selectIncidentMasters,
  selectMapMasters,
  selectMemberAliases,
  selectSeasonMasters,
} from "@/features/masters/masterQueries";
import type {
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  MemberAliasResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import {
  gameTitlesQueryOptions,
  incidentMastersQueryOptions,
  mapMastersQueryOptions,
  memberAliasesQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useAuthorization } from "@/shared/auth/useAuthorization";

const noGameTitles: GameTitleResponse[] = [];
const noIncidentMasters: IncidentMasterResponse[] = [];
const noMapMasters: MapMasterResponse[] = [];
const noMemberAliases: MemberAliasResponse[] = [];
const noSeasonMasters: SeasonMasterResponse[] = [];

export function useMasterResourceQueries(
  selectedGameTitleId: string,
  enabled: { catalog: boolean; aliases: boolean; incidents: boolean },
) {
  const authorization = useAuthorization();
  const gameTitlesQuery = useQuery({
    ...gameTitlesQueryOptions(),
    select: selectGameTitles,
    enabled: () => enabled.catalog && authorization.can("operations"),
  });
  const incidentMastersQuery = useQuery({
    ...incidentMastersQueryOptions(),
    select: selectIncidentMasters,
    enabled: () => enabled.incidents && authorization.can("operations"),
  });
  const memberAliasesQuery = useQuery({
    ...memberAliasesQueryOptions(),
    select: selectMemberAliases,
    enabled: () => enabled.aliases && authorization.can("admin"),
  });
  const gameTitles = gameTitlesQuery.data ?? noGameTitles;
  const effectiveSelectedGameTitleId = gameTitles.some(
    (gameTitle) => gameTitle.id === selectedGameTitleId,
  )
    ? selectedGameTitleId
    : (gameTitles[0]?.id ?? "");

  const mapMastersQuery = useQuery({
    ...mapMastersQueryOptions(
      effectiveSelectedGameTitleId,
      enabled.catalog && Boolean(effectiveSelectedGameTitleId),
    ),
    select: selectMapMasters,
    enabled: () =>
      enabled.catalog && Boolean(effectiveSelectedGameTitleId) && authorization.can("operations"),
  });

  const seasonMastersQuery = useQuery({
    ...seasonMastersQueryOptions(
      effectiveSelectedGameTitleId,
      enabled.catalog && Boolean(effectiveSelectedGameTitleId),
    ),
    select: selectSeasonMasters,
    enabled: () =>
      enabled.catalog && Boolean(effectiveSelectedGameTitleId) && authorization.can("operations"),
  });

  return {
    gameTitles,
    gameTitlesQuery,
    incidentMasters: incidentMastersQuery.data ?? noIncidentMasters,
    incidentMastersQuery,
    mapMasters: mapMastersQuery.data ?? noMapMasters,
    mapMastersQuery,
    memberAliases: memberAliasesQuery.data ?? noMemberAliases,
    memberAliasesQuery,
    seasonMasters: seasonMastersQuery.data ?? noSeasonMasters,
    seasonMastersQuery,
    selectedGameTitleId: effectiveSelectedGameTitleId,
  };
}
