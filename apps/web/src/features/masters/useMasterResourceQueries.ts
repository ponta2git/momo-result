import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
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
  const gameTitlesQuery = useSuspenseQuery({
    queryKey: masterQueryKeys.gameTitles(authScope),
    queryFn: fetchGameTitles,
  });

  const mapMastersQuery = useQuery({
    queryKey: masterQueryKeys.mapMasters(authScope, selectedGameTitleId),
    queryFn: () => fetchMapMasters(selectedGameTitleId),
    enabled: Boolean(selectedGameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: masterQueryKeys.seasonMasters(authScope, selectedGameTitleId),
    queryFn: () => fetchSeasonMasters(selectedGameTitleId),
    enabled: Boolean(selectedGameTitleId),
  });

  const incidentMastersQuery = useSuspenseQuery({
    queryKey: masterQueryKeys.incidentMasters(authScope),
    queryFn: fetchIncidentMasters,
  });

  const memberAliasesQuery = useSuspenseQuery({
    queryKey: masterQueryKeys.memberAliases(authScope),
    queryFn: fetchMemberAliases,
  });

  const gameTitles = useMemo(() => gameTitlesQuery.data ?? [], [gameTitlesQuery.data]);
  const mapMasters = useMemo(() => mapMastersQuery.data ?? [], [mapMastersQuery.data]);
  const memberAliases = useMemo(() => memberAliasesQuery.data ?? [], [memberAliasesQuery.data]);
  const seasonMasters = useMemo(() => seasonMastersQuery.data ?? [], [seasonMastersQuery.data]);

  return {
    gameTitles,
    incidentMasters: incidentMastersQuery.data,
    mapMasters,
    mapMastersQuery,
    memberAliases,
    seasonMasters,
    seasonMastersQuery,
  };
}
