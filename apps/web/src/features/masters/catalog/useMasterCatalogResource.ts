import { useQuery } from "@tanstack/react-query";

import { resolveMasterSelectionId } from "@/features/masters/catalog/catalogPresentation";
import {
  selectGameTitles,
  selectMapMasters,
  selectSeasonMasters,
} from "@/features/masters/catalog/catalogSelectors";
import {
  masterDirectoryState,
  masterResourceErrorMessage,
} from "@/features/masters/masterDirectoryState";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

const noGameTitles: GameTitleResponse[] = [];
const noMapMasters: MapMasterResponse[] = [];
const noSeasonMasters: SeasonMasterResponse[] = [];

/** Reads the selected title's catalog without exposing observer results to its editor. */
export function useMasterCatalogResource(selectedGameTitleId: string, enabled: boolean) {
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("operations");
  const authScope = String(permission.epoch);
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

  const gameTitlesFailed = useRetryNotice(
    shouldShowQueryError(gameTitlesQuery),
    gameTitlesQuery.isFetching,
    authScope,
  );
  const mapMastersFailed = useRetryNotice(
    shouldShowQueryError(mapMastersQuery),
    mapMastersQuery.isFetching,
    `${authScope}:${effectiveSelectedGameTitleId}`,
  );
  const seasonMastersFailed = useRetryNotice(
    shouldShowQueryError(seasonMastersQuery),
    seasonMastersQuery.isFetching,
    `${authScope}:${effectiveSelectedGameTitleId}`,
  );
  const mapError = useRetryNotice(
    masterResourceErrorMessage(mapMastersQuery.error),
    mapMastersQuery.isFetching,
    effectiveSelectedGameTitleId,
  );
  const seasonError = useRetryNotice(
    masterResourceErrorMessage(seasonMastersQuery.error),
    seasonMastersQuery.isFetching,
    effectiveSelectedGameTitleId,
  );

  return {
    gameTitles: {
      items: gameTitles,
      ...masterDirectoryState({
        hasData: gameTitlesQuery.data !== undefined,
        failed: gameTitlesFailed,
        initialLoading: isInitialQueryLoading(gameTitlesQuery),
        fetching: gameTitlesQuery.isFetching,
        mutationPending: false,
      }),
      refresh: async () =>
        Boolean(authorization.begin("operations")) && (await gameTitlesQuery.refetch()).isSuccess,
    },
    mapMasters: {
      items: mapMastersQuery.data ?? noMapMasters,
      ...masterDirectoryState({
        hasData: mapMastersQuery.data !== undefined,
        failed: mapMastersFailed,
        initialLoading: isInitialQueryLoading(mapMastersQuery),
        fetching: mapMastersQuery.isFetching,
        mutationPending: false,
      }),
      error: mapMastersFailed ? mapError : undefined,
      refresh: () => {
        if (authorization.begin("operations")) void mapMastersQuery.refetch();
      },
    },
    seasonMasters: {
      items: seasonMastersQuery.data ?? noSeasonMasters,
      ...masterDirectoryState({
        hasData: seasonMastersQuery.data !== undefined,
        failed: seasonMastersFailed,
        initialLoading: isInitialQueryLoading(seasonMastersQuery),
        fetching: seasonMastersQuery.isFetching,
        mutationPending: false,
      }),
      error: seasonMastersFailed ? seasonError : undefined,
      refresh: () => {
        if (authorization.begin("operations")) void seasonMastersQuery.refetch();
      },
    },
    selectedGameTitleId: effectiveSelectedGameTitleId,
  };
}
