import { useQuery, useSuspenseQueries } from "@tanstack/react-query";

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
  MapMasterResponse,
  MemberAliasResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

const noGameTitles: GameTitleResponse[] = [];
const noMapMasters: MapMasterResponse[] = [];
const noMemberAliases: MemberAliasResponse[] = [];
const noSeasonMasters: SeasonMasterResponse[] = [];

export function useMasterResourceQueries(authScope: string, selectedGameTitleId: string) {
  const [gameTitlesQuery, incidentMastersQuery, memberAliasesQuery] = useSuspenseQueries({
    queries: [
      {
        queryKey: masterQueryKeys.gameTitles(authScope),
        queryFn: ({ signal }) => fetchGameTitles({ signal }),
      },
      {
        queryKey: masterQueryKeys.incidentMasters(authScope),
        queryFn: ({ signal }) => fetchIncidentMasters({ signal }),
      },
      {
        queryKey: masterQueryKeys.memberAliases(authScope),
        queryFn: ({ signal }) => fetchMemberAliases({ signal }),
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
    enabled: Boolean(effectiveSelectedGameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: masterQueryKeys.seasonMasters(authScope, effectiveSelectedGameTitleId),
    queryFn: ({ signal }) => fetchSeasonMasters(effectiveSelectedGameTitleId, { signal }),
    enabled: Boolean(effectiveSelectedGameTitleId),
  });

  return {
    gameTitles,
    gameTitlesQuery,
    incidentMasters: incidentMastersQuery.data,
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
