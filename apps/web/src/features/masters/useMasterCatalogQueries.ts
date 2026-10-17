import { useQuery } from "@tanstack/react-query";

import {
  selectGameTitles,
  selectMapMasters,
  selectSeasonMasters,
} from "@/features/masters/masterQueries";
import { resolveMasterSelectionId } from "@/features/masters/masterViewModel";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import {
  gameTitlesQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useAuthorizationOperations } from "@/shared/auth/useAuthorization";

const noGameTitles: GameTitleResponse[] = [];
const noMapMasters: MapMasterResponse[] = [];
const noSeasonMasters: SeasonMasterResponse[] = [];

export function useMasterCatalogQueries(selectedGameTitleId: string, enabled: boolean) {
  const authorization = useAuthorizationOperations();
  const gameTitlesQuery = useQuery({
    ...gameTitlesQueryOptions(),
    select: selectGameTitles,
    enabled: () => enabled && authorization.can("operations"),
  });
  const gameTitles = gameTitlesQuery.data ?? noGameTitles;
  const effectiveSelectedGameTitleId = resolveMasterSelectionId(gameTitles, selectedGameTitleId);

  const mapMastersQuery = useQuery({
    ...mapMastersQueryOptions(
      effectiveSelectedGameTitleId,
      enabled && Boolean(effectiveSelectedGameTitleId),
    ),
    select: selectMapMasters,
    enabled: () =>
      enabled && Boolean(effectiveSelectedGameTitleId) && authorization.can("operations"),
  });

  const seasonMastersQuery = useQuery({
    ...seasonMastersQueryOptions(
      effectiveSelectedGameTitleId,
      enabled && Boolean(effectiveSelectedGameTitleId),
    ),
    select: selectSeasonMasters,
    enabled: () =>
      enabled && Boolean(effectiveSelectedGameTitleId) && authorization.can("operations"),
  });

  return {
    gameTitles,
    gameTitlesQuery,
    mapMasters: mapMastersQuery.data ?? noMapMasters,
    mapMastersQuery,
    seasonMasters: seasonMastersQuery.data ?? noSeasonMasters,
    seasonMastersQuery,
    selectedGameTitleId: effectiveSelectedGameTitleId,
  };
}
