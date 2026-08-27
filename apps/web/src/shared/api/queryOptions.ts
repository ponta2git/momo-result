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
import { getOcrDraft, getOcrDraftsBulk } from "@/shared/api/ocrDrafts";
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

/** A bounded, unfiltered directory shared by screens that only resolve held-event names. */
const heldEventDirectoryQuery = { limit: 100 } as const;

export function heldEventsQueryOptions(query: ListHeldEventsQuery) {
  return queryOptions({
    ...heldEventsQueryDefinition(query),
    placeholderData: keepPreviousData,
  });
}

export function heldEventDirectoryQueryOptions() {
  return queryOptions({
    ...heldEventDirectoryQueryDefinition(),
    placeholderData: keepPreviousData,
  });
}

export function heldEventDirectorySuspenseQueryOptions() {
  return heldEventDirectoryQueryDefinition();
}

function heldEventDirectoryQueryDefinition() {
  return queryOptions({
    queryKey: heldEventKeys.scope("directory"),
    queryFn: ({ signal }) => listHeldEvents(heldEventDirectoryQuery, { signal }),
  });
}

function heldEventsQueryDefinition(query: ListHeldEventsQuery) {
  // A single normalized value owns both cache identity and request behavior.
  const normalizedQuery = normalizeHeldEventsQuery(query);
  return queryOptions({
    queryKey: heldEventKeys.list(normalizedQuery),
    queryFn: ({ signal }) => listHeldEvents(normalizedQuery, { signal }),
  });
}

function normalizeHeldEventsQuery(query: ListHeldEventsQuery): ListHeldEventsQuery {
  const normalizedQ = query.q?.trim();
  return {
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
    ...(normalizedQ ? { q: normalizedQ } : {}),
  };
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

export function gameTitlesQueryOptions() {
  return queryOptions({
    queryKey: masterKeys.gameTitles.list(),
    queryFn: ({ signal }) => listGameTitles({ signal }),
  });
}

export function mapMastersQueryOptions(gameTitleId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: masterKeys.mapMasters.list(gameTitleId),
    queryFn: ({ signal }) => listMapMasters(gameTitleId || undefined, { signal }),
    enabled,
  });
}

export function seasonMastersQueryOptions(gameTitleId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: masterKeys.seasonMasters.list(gameTitleId),
    queryFn: ({ signal }) => listSeasonMasters(gameTitleId || undefined, { signal }),
    enabled,
  });
}

export function memberAliasesQueryOptions() {
  return queryOptions({
    queryKey: masterKeys.memberAliases.list(),
    queryFn: ({ signal }) => listMemberAliases({ signal }),
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

export function ocrDraftDetailQueryOptions(draftId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: ocrDraftKeys.detail(draftId),
    queryFn: ({ signal }) => {
      if (!draftId) {
        throw new Error("OCR draft detail query is not ready");
      }
      return getOcrDraft(draftId, { signal });
    },
    enabled: enabled && Boolean(draftId),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
