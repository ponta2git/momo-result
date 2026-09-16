import { useQueries, useQuery } from "@tanstack/react-query";

import {
  fetchGameTitles,
  fetchIncidentMasters,
  fetchMapMasters,
  fetchMemberAliases,
  fetchSeasonMasters,
  masterQueryKeys,
} from "@/features/masters/masterQueries";
import type {
  GameTitleResponse,
  IncidentMasterResponse,
  MapMasterResponse,
  MemberAliasResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

const noGameTitles: GameTitleResponse[] = [];
const noIncidentMasters: IncidentMasterResponse[] = [];
const noMapMasters: MapMasterResponse[] = [];
const noMemberAliases: MemberAliasResponse[] = [];
const noSeasonMasters: SeasonMasterResponse[] = [];

export function useMasterResourceQueries(
  authScope: string,
  selectedGameTitleId: string,
  enabled: boolean,
) {
  const [gameTitlesQuery, incidentMastersQuery, memberAliasesQuery] = useQueries({
    queries: [
      {
        queryKey: masterQueryKeys.gameTitles(authScope),
        queryFn: ({ signal }) => fetchGameTitles({ signal }),
        enabled,
      },
      {
        queryKey: masterQueryKeys.incidentMasters(authScope),
        queryFn: ({ signal }) => fetchIncidentMasters({ signal }),
        enabled,
      },
      {
        queryKey: masterQueryKeys.memberAliases(authScope),
        queryFn: ({ signal }) => fetchMemberAliases({ signal }),
        enabled,
      },
    ],
  });
  const gameTitles = gameTitlesQuery.data ?? noGameTitles;
  const effectiveSelectedGameTitleId = gameTitles.some(
    (gameTitle) => gameTitle.id === selectedGameTitleId,
  )
    ? selectedGameTitleId
    : (gameTitles[0]?.id ?? "");

  const mapMastersQuery = useQuery({
    queryKey: masterQueryKeys.mapMasters(authScope, effectiveSelectedGameTitleId),
    queryFn: ({ signal }) => fetchMapMasters(effectiveSelectedGameTitleId, { signal }),
    enabled: enabled && Boolean(effectiveSelectedGameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: masterQueryKeys.seasonMasters(authScope, effectiveSelectedGameTitleId),
    queryFn: ({ signal }) => fetchSeasonMasters(effectiveSelectedGameTitleId, { signal }),
    enabled: enabled && Boolean(effectiveSelectedGameTitleId),
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
