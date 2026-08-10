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
  seriesAnalysisKeys,
} from "@/shared/api/queryKeys";
import {
  getSeriesAnalysisAdminOverview,
  getSeriesAnalysisAggregate,
  getSeriesAnalysisDrilldown,
  getSeriesAnalysisMatchContext,
  getSeriesAnalysisOptions,
  getSeriesAnalysisReview,
  getSeriesAnalysisStatus,
} from "@/shared/api/seriesAnalysis";
import type {
  SeriesAnalysisDrilldownQuery,
  SeriesAnalysisMatchContextQuery,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";

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
    queryKey:
      typeof query === "string"
        ? heldEventKeys.scope(scope)
        : heldEventKeys.list({ ...query, scope }),
    queryFn: ({ signal }) => listHeldEvents(query, limit, { signal }),
    placeholderData: keepPreviousData,
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
    queryKey: matchKeys.detail(matchId),
    queryFn: ({ signal }) => {
      if (!matchId) {
        throw new Error("match detail query is not ready");
      }
      return getMatch(matchId, { signal });
    },
    enabled: enabled && Boolean(matchId),
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

export function seriesAnalysisOptionsQueryOptions() {
  return queryOptions({
    queryKey: seriesAnalysisKeys.options(),
    queryFn: ({ signal }) => getSeriesAnalysisOptions({ signal }),
  });
}

export function seriesAnalysisStatusQueryOptions(gameTitleId: string | undefined) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.status(gameTitleId),
    queryFn: ({ signal }) => {
      if (!gameTitleId) throw new Error("series analysis status query is not ready");
      return getSeriesAnalysisStatus(gameTitleId, { signal });
    },
    enabled: Boolean(gameTitleId),
    refetchInterval: (query) => {
      const status = query.state.data?.calculation?.status;
      return status === "queued" || status === "running" ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function seriesAnalysisAggregateQueryOptions(query: SeriesAnalysisQuery | undefined) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.aggregate(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis aggregate query is not ready");
      return getSeriesAnalysisAggregate(query, { signal });
    },
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function seriesAnalysisReviewQueryOptions(
  query: SeriesAnalysisQuery | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.review(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis review query is not ready");
      return getSeriesAnalysisReview(query, { signal });
    },
    enabled: enabled && query !== undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function seriesAnalysisDrilldownQueryOptions(
  query: SeriesAnalysisDrilldownQuery | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.drilldown(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis drilldown query is not ready");
      return getSeriesAnalysisDrilldown(query, { signal });
    },
    enabled: enabled && query !== undefined,
    retry: false,
  });
}

export function seriesAnalysisMatchContextQueryOptions(
  query: SeriesAnalysisMatchContextQuery | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.matchContext(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis match context query is not ready");
      return getSeriesAnalysisMatchContext(query, { signal });
    },
    enabled: enabled && query !== undefined,
    retry: false,
  });
}

export function seriesAnalysisAdminOverviewQueryOptions(
  gameTitleId: string | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: seriesAnalysisKeys.adminOverview(gameTitleId),
    queryFn: ({ signal }) => getSeriesAnalysisAdminOverview(gameTitleId, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const execution = query.state.data?.globalExecution;
      return execution &&
        (execution.runningCount > 0 ||
          execution.queuedTitleCount > 0 ||
          execution.activeCampaignCount > 0)
        ? 5_000
        : false;
    },
    refetchIntervalInBackground: false,
  });
}
