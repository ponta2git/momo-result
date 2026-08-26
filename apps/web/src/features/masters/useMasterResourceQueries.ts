import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  fetchGameTitles,
  fetchIncidentMasters,
  fetchMapMasters,
  fetchMemberAliases,
  fetchSeasonMasters,
  masterQueryKeys,
} from "@/features/masters/masterQueries";

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

  const mapMastersQuery = useQuery({
    queryKey: masterQueryKeys.mapMasters(authScope, selectedGameTitleId),
    queryFn: ({ signal }) => fetchMapMasters(selectedGameTitleId, { signal }),
    enabled: Boolean(selectedGameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: masterQueryKeys.seasonMasters(authScope, selectedGameTitleId),
    queryFn: ({ signal }) => fetchSeasonMasters(selectedGameTitleId, { signal }),
    enabled: Boolean(selectedGameTitleId),
  });

  const gameTitles = useMemo(() => gameTitlesQuery.data ?? [], [gameTitlesQuery.data]);
  const mapMasters = useMemo(() => mapMastersQuery.data ?? [], [mapMastersQuery.data]);
  const memberAliases = useMemo(() => memberAliasesQuery.data ?? [], [memberAliasesQuery.data]);
  const seasonMasters = useMemo(() => seasonMastersQuery.data ?? [], [seasonMastersQuery.data]);

  return {
    gameTitles,
    gameTitlesQuery,
    incidentMasters: incidentMastersQuery.data,
    incidentMastersQuery,
    mapMasters,
    mapMastersQuery,
    memberAliases,
    memberAliasesQuery,
    seasonMasters,
    seasonMastersQuery,
  };
}
