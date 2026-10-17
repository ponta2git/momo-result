import { useQuery } from "@tanstack/react-query";

import {
  candidateFromHeldEventSummary,
  candidateFromMatchIdentity,
  toHeldEventCandidates,
  toMatchCandidates,
  toSeasonCandidates,
} from "@/features/exports/exportCandidateData";
import type { ExportScope } from "@/features/exports/exportTypes";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  heldEventSummaryReadQueryOptions,
  heldEventsQueryOptions,
  matchExportCandidatesQueryOptions,
  matchIdentityReadQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { cursorForPage } from "@/shared/lib/cursorPagination";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

const CANDIDATE_PAGE_SIZE = 20;

/** Resolves directory freshness and authoritative target absence before selection uses the read. */
export function useExportCandidateResource({
  scope,
  selectedId,
  heldEventPage,
  matchCursor,
}: {
  scope: ExportScope;
  selectedId: string;
  heldEventPage: number;
  matchCursor: string;
}) {
  const seasonsQuery = useQuery(seasonMastersQueryOptions(undefined, scope === "season"));
  const heldEventsQuery = useQuery({
    ...heldEventsQueryOptions({ page: heldEventPage, pageSize: CANDIDATE_PAGE_SIZE }),
    enabled: scope === "heldEvent",
  });
  const matchesQuery = useQuery({
    ...matchExportCandidatesQueryOptions({
      kind: "match",
      ...(matchCursor ? { cursor: matchCursor } : {}),
      pageSize: CANDIDATE_PAGE_SIZE,
      sort: "held_desc",
      status: "confirmed",
    }),
    enabled: scope === "match",
  });
  const hasCurrentHeldEventData =
    heldEventsQuery.data !== undefined && !heldEventsQuery.isPlaceholderData;
  const hasCurrentMatchData = matchesQuery.data !== undefined && !matchesQuery.isPlaceholderData;
  const seasons = seasonsQuery.data?.items ?? [];
  const heldEvents =
    hasCurrentHeldEventData || !shouldShowQueryError(heldEventsQuery)
      ? (heldEventsQuery.data?.items ?? [])
      : [];
  const matches =
    hasCurrentMatchData || !shouldShowQueryError(matchesQuery)
      ? (matchesQuery.data?.items ?? [])
      : [];
  const candidates =
    scope === "season"
      ? toSeasonCandidates(seasons)
      : scope === "heldEvent"
        ? toHeldEventCandidates(heldEvents)
        : scope === "match"
          ? toMatchCandidates(matches)
          : [];
  const selectedOnCurrentPage = candidates.find((candidate) => candidate.value === selectedId);
  const shouldResolveHeldEvent =
    scope === "heldEvent" && Boolean(selectedId) && !selectedOnCurrentPage;
  const shouldResolveMatch = scope === "match" && Boolean(selectedId) && !selectedOnCurrentPage;

  // A cached directory row cannot disable revalidation of a target already confirmed absent.
  const heldEventSummaryQuery = useQuery({
    ...heldEventSummaryReadQueryOptions(scope === "heldEvent" ? selectedId : undefined),
    enabled: (query) =>
      shouldResolveHeldEvent ||
      (scope === "heldEvent" && Boolean(selectedId) && query.state.data?.kind === "notFound"),
  });
  const matchIdentityQuery = useQuery({
    ...matchIdentityReadQueryOptions(scope === "match" ? selectedId : undefined),
    enabled: (query) =>
      shouldResolveMatch ||
      (scope === "match" && Boolean(selectedId) && query.state.data?.kind === "notFound"),
  });
  const canonicalCandidate =
    selectedOnCurrentPage ??
    (scope === "heldEvent"
      ? candidateFromHeldEventSummary(
          heldEventSummaryQuery.data?.kind === "found"
            ? heldEventSummaryQuery.data.value
            : undefined,
        )
      : scope === "match"
        ? candidateFromMatchIdentity(
            matchIdentityQuery.data?.kind === "found" ? matchIdentityQuery.data.value : undefined,
          )
        : undefined);
  const selectedDetailQuery =
    scope === "heldEvent"
      ? heldEventSummaryQuery
      : scope === "match"
        ? matchIdentityQuery
        : undefined;
  const requiresLookup = shouldResolveHeldEvent || shouldResolveMatch;
  const targetFailure =
    selectedDetailQuery?.data?.kind === "notFound"
      ? ("not-found" as const)
      : requiresLookup && selectedDetailQuery && shouldShowQueryError(selectedDetailQuery)
        ? ("load-failed" as const)
        : null;
  const seasonError = useRetryNotice(
    shouldShowQueryError(seasonsQuery),
    seasonsQuery.isFetching,
    scope,
  );
  const heldEventError = useRetryNotice(
    shouldShowQueryError(heldEventsQuery),
    heldEventsQuery.isFetching,
    String(heldEventPage),
  );
  const matchError = useRetryNotice(
    shouldShowQueryError(matchesQuery),
    matchesQuery.isFetching,
    matchCursor,
  );
  const directoryQuery =
    scope === "season"
      ? seasonsQuery
      : scope === "heldEvent"
        ? heldEventsQuery
        : scope === "match"
          ? matchesQuery
          : undefined;
  const activity = directoryQuery?.isLoading
    ? ("loading" as const)
    : directoryQuery?.isFetching
      ? ("refreshing" as const)
      : ("idle" as const);
  return {
    directory: {
      candidates,
      activity,
      failed:
        scope === "season"
          ? seasonError
          : scope === "heldEvent"
            ? heldEventError
            : scope === "match"
              ? matchError
              : false,
      hasCurrentData:
        scope === "season"
          ? seasonsQuery.data !== undefined
          : scope === "heldEvent"
            ? hasCurrentHeldEventData
            : scope === "match"
              ? hasCurrentMatchData
              : true,
      pagination:
        scope === "heldEvent"
          ? heldEventsQuery.data?.pagination
          : scope === "match"
            ? matchesQuery.data?.pagination
            : undefined,
      scopeChanging:
        scope === "heldEvent"
          ? Boolean(heldEventsQuery.isPlaceholderData && heldEventsQuery.isFetching)
          : scope === "match"
            ? Boolean(matchesQuery.isPlaceholderData && matchesQuery.isFetching)
            : false,
    },
    target: {
      candidate: canonicalCandidate,
      onCurrentPage: selectedOnCurrentPage,
      failure: targetFailure,
      refreshing: selectedDetailQuery?.isFetching === true,
      requiresLookup,
    },
    matchCursorForPage: (page: number) =>
      matchesQuery.data ? cursorForPage(matchesQuery.data.pagination, page) : undefined,
    refreshDirectory: () => {
      if (scope === "season") void seasonsQuery.refetch();
      if (scope === "heldEvent") {
        void heldEventsQuery.refetch();
        if (shouldResolveHeldEvent && shouldShowQueryError(heldEventSummaryQuery))
          void heldEventSummaryQuery.refetch();
      }
      if (scope === "match") {
        void matchesQuery.refetch();
        if (shouldResolveMatch && shouldShowQueryError(matchIdentityQuery))
          void matchIdentityQuery.refetch();
      }
    },
    refreshSelection: () => {
      if (shouldResolveHeldEvent) void heldEventSummaryQuery.refetch();
      if (shouldResolveMatch) void matchIdentityQuery.refetch();
    },
  };
}
