import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { listLoginAccounts } from "@/shared/api/adminAccounts";
import { getHeldEventDetail, listHeldEvents } from "@/shared/api/heldEvents";
import type { ListHeldEventsQuery } from "@/shared/api/heldEvents";
import {
  listGameTitles,
  listMapMasters,
  listMemberAliases,
  listSeasonMasters,
} from "@/shared/api/masters";
import { getMatchDraftDetail, listMatchDraftSourceImages } from "@/shared/api/matchDrafts";
import { getMatch, getMatchListSummary, listMatches } from "@/shared/api/matches";
import type { ListMatchesQuery } from "@/shared/api/matches";
import { getOcrDraftsBulk } from "@/shared/api/ocrDrafts";
import {
  adminAccountKeys,
  heldEventKeys,
  masterKeys,
  matchKeys,
  ocrDraftKeys,
} from "@/shared/api/queryKeys";

export function adminLoginAccountsQueryOptions() {
  return queryOptions({
    queryKey: adminAccountKeys.all(),
    queryFn: ({ signal }) => listLoginAccounts({ signal }),
  });
}

export function heldEventsQueryOptions(
  query: ListHeldEventsQuery | string = "",
  limit = 10,
  scope = "list",
) {
  return queryOptions({
    ...heldEventsQueryDefinition(query, limit, scope),
    placeholderData: keepPreviousData,
  });
}

export function heldEventsSuspenseQueryOptions(
  query: ListHeldEventsQuery | string = "",
  limit = 10,
  scope = "list",
) {
  return heldEventsQueryDefinition(query, limit, scope);
}

function heldEventsQueryDefinition(
  query: ListHeldEventsQuery | string,
  limit: number,
  scope: string,
) {
  return queryOptions({
    queryKey:
      typeof query === "string"
        ? heldEventKeys.scope(scope)
        : heldEventKeys.list({ ...query, scope }),
    queryFn: ({ signal }) => listHeldEvents(query, limit, { signal }),
  });
}

export function heldEventDetailQueryOptions(heldEventId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: heldEventKeys.detail(heldEventId),
    queryFn: ({ signal }) => {
      if (!heldEventId) {
        throw new Error("held event detail query is not ready");
      }
      return getHeldEventDetail(heldEventId, { signal });
    },
    enabled: enabled && Boolean(heldEventId),
  });
}

export function gameTitlesQueryOptions(scope: string) {
  return queryOptions({
    queryKey: masterKeys.gameTitles.list(scope),
    queryFn: ({ signal }) => listGameTitles({ signal }),
  });
}

export function mapMastersQueryOptions(
  scope: string,
  gameTitleId: string | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: masterKeys.mapMasters.list(scope, gameTitleId),
    queryFn: ({ signal }) => listMapMasters(gameTitleId || undefined, { signal }),
    enabled,
  });
}

export function seasonMastersQueryOptions(
  scope: string,
  gameTitleId: string | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: masterKeys.seasonMasters.list(scope, gameTitleId),
    queryFn: ({ signal }) => listSeasonMasters(gameTitleId || undefined, { signal }),
    enabled,
  });
}

export function memberAliasesQueryOptions(scope: string, memberId?: string | undefined) {
  return queryOptions({
    queryKey: masterKeys.memberAliases.list(scope),
    queryFn: ({ signal }) => listMemberAliases(memberId, { signal }),
  });
}

export function matchListQueryOptions(query: ListMatchesQuery) {
  return queryOptions({
    queryKey: matchKeys.list(query),
    queryFn: ({ signal }) => listMatches(query, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function matchExportCandidatesQueryOptions(query: ListMatchesQuery) {
  return queryOptions({
    queryKey: matchKeys.exports(query),
    queryFn: ({ signal }) => listMatches(query, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function matchListSummaryQueryOptions(
  query: Pick<ListMatchesQuery, "gameTitleId" | "heldEventId" | "seasonMasterId">,
) {
  return queryOptions({
    queryKey: matchKeys.summary(query),
    queryFn: ({ signal }) => getMatchListSummary(query, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function matchDetailQueryOptions(matchId: string | undefined, enabled = true) {
  return queryOptions({
    ...matchDetailQueryDefinition(matchId),
    enabled: enabled && Boolean(matchId),
  });
}

export function matchDetailPrefetchQueryOptions(matchId: string | undefined) {
  return matchDetailQueryDefinition(matchId);
}

function matchDetailQueryDefinition(matchId: string | undefined) {
  return queryOptions({
    queryKey: matchKeys.detail(matchId),
    queryFn: ({ signal }) => {
      if (!matchId) {
        throw new Error("match detail query is not ready");
      }
      return getMatch(matchId, { signal });
    },
  });
}

export function matchDraftDetailQueryOptions(draftId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: matchKeys.draft.detail(draftId),
    queryFn: ({ signal }) => {
      if (!draftId) {
        throw new Error("match draft detail query is not ready");
      }
      return getMatchDraftDetail(draftId, { signal });
    },
    enabled: enabled && Boolean(draftId),
  });
}

export function matchDraftSourceImagesQueryOptions(draftId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: matchKeys.draft.sourceImages(draftId),
    queryFn: ({ signal }) => {
      if (!draftId) {
        throw new Error("match draft source images query is not ready");
      }
      return listMatchDraftSourceImages(draftId, { signal });
    },
    enabled: enabled && Boolean(draftId),
  });
}

export function ocrDraftsBulkQueryOptions(draftIds: string[], enabled = true) {
  return queryOptions({
    queryKey: ocrDraftKeys.bulk(draftIds),
    queryFn: ({ signal }) => getOcrDraftsBulk(draftIds, { signal }),
    enabled: enabled && draftIds.length > 0,
    retry: false,
  });
}
