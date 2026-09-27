import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { listLoginAccounts } from "@/shared/api/adminAccounts";
import { loadHeldEventDetail, loadMatchDetail } from "@/shared/api/detailReadResult";
import { getHeldEventSummary, listHeldEvents } from "@/shared/api/heldEvents";
import type { ListHeldEventsQuery } from "@/shared/api/heldEvents";
import {
  listGameTitles,
  listIncidentMasters,
  listMapMasters,
  listMemberAliases,
  listSeasonMasters,
} from "@/shared/api/masters";
import { getMatchDraftDetail, getMatchDraftReview } from "@/shared/api/matchDrafts";
import { getMatchIdentity, getMatchListSummary, listMatches } from "@/shared/api/matches";
import type { ListMatchesQuery } from "@/shared/api/matches";
import { getNotificationSettings } from "@/shared/api/notificationSettings";
import { getOcrDraft } from "@/shared/api/ocrDrafts";
import {
  adminAccountKeys,
  heldEventKeys,
  masterKeys,
  matchKeys,
  notificationSettingsKeys,
  ocrDraftKeys,
} from "@/shared/api/queryKeys";
import { loadResourceReadResult } from "@/shared/api/resourceReadResult";

export function adminLoginAccountsQueryOptions() {
  return queryOptions({
    queryKey: adminAccountKeys.all(),
    queryFn: ({ signal }) => listLoginAccounts({ signal }),
  });
}

export function notificationSettingsQueryOptions() {
  return queryOptions({
    queryKey: notificationSettingsKeys.all(),
    queryFn: ({ signal }) => getNotificationSettings({ signal }),
  });
}

export function heldEventsQueryOptions(query: ListHeldEventsQuery) {
  const normalizedQuery = normalizeHeldEventsQuery(query);
  return queryOptions({
    queryKey: heldEventKeys.list(normalizedQuery),
    queryFn: ({ signal }) => listHeldEvents(normalizedQuery, { signal }),
    placeholderData: keepPreviousData,
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
      return loadHeldEventDetail(heldEventId, { signal });
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

export function incidentMastersQueryOptions() {
  return queryOptions({
    queryKey: masterKeys.incidentMasters.list(),
    queryFn: ({ signal }) => listIncidentMasters({ signal }),
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
      return loadMatchDetail(matchId, { signal });
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

export function heldEventSummaryQueryOptions(heldEventId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: heldEventKeys.summary(heldEventId),
    queryFn: ({ signal }) => {
      if (!heldEventId) throw new Error("held event summary query is not ready");
      return getHeldEventSummary(heldEventId, { signal });
    },
    enabled: enabled && Boolean(heldEventId),
  });
}

export function matchIdentityQueryOptions(matchId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: matchKeys.identity(matchId),
    queryFn: ({ signal }) => {
      if (!matchId) throw new Error("match identity query is not ready");
      return getMatchIdentity(matchId, { signal });
    },
    enabled: enabled && Boolean(matchId),
  });
}

export function heldEventSummaryReadQueryOptions(heldEventId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: heldEventKeys.summaryRead(heldEventId),
    queryFn: ({ signal }) => {
      if (!heldEventId) throw new Error("held event summary read query is not ready");
      return loadResourceReadResult(() => getHeldEventSummary(heldEventId, { signal }));
    },
    enabled: enabled && Boolean(heldEventId),
  });
}

export function matchIdentityReadQueryOptions(matchId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: matchKeys.identityRead(matchId),
    queryFn: ({ signal }) => {
      if (!matchId) throw new Error("match identity read query is not ready");
      return loadResourceReadResult(() => getMatchIdentity(matchId, { signal }));
    },
    enabled: enabled && Boolean(matchId),
  });
}

export function matchDraftReviewQueryOptions(draftId: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: matchKeys.draft.review(draftId),
    queryFn: ({ signal }) => {
      if (!draftId) throw new Error("match draft review query is not ready");
      return getMatchDraftReview(draftId, { signal });
    },
    enabled: enabled && Boolean(draftId),
    retry: false,
  });
}
