import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  candidateFromHeldEventSummary,
  candidateFromMatchIdentity,
  resolveExportCandidate,
  toHeldEventCandidates,
  toMatchCandidates,
  toSeasonCandidates,
} from "@/features/exports/exportCandidateData";
import type { ExportCandidate, ExportScope } from "@/features/exports/exportTypes";
import { buildCandidateSupportIssue, buildCandidateView } from "@/features/exports/exportViewModel";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  heldEventSummaryQueryOptions,
  heldEventsQueryOptions,
  matchExportCandidatesQueryOptions,
  matchIdentityQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { cursorForPage } from "@/shared/lib/cursorPagination";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

const CANDIDATE_PAGE_SIZE = 20;

export function useExportCandidates({
  scope,
  selectedId,
}: {
  scope: ExportScope;
  selectedId: string;
}) {
  const [heldEventPage, setHeldEventPage] = useState(1);
  const [matchCursor, setMatchCursor] = useState("");
  const [selectionSnapshot, setSelectionSnapshot] = useState<{
    candidate: ExportCandidate;
    scope: ExportScope;
  } | null>(null);

  const seasonsQuery = useQuery(seasonMastersQueryOptions(undefined, scope === "season"));
  const heldEventsOptions = heldEventsQueryOptions({
    page: heldEventPage,
    pageSize: CANDIDATE_PAGE_SIZE,
  });
  const heldEventsQuery = useQuery({
    ...heldEventsOptions,
    enabled: scope === "heldEvent",
  });
  const matchesOptions = matchExportCandidatesQueryOptions({
    kind: "match",
    ...(matchCursor ? { cursor: matchCursor } : {}),
    pageSize: CANDIDATE_PAGE_SIZE,
    sort: "held_desc",
    status: "confirmed",
  });
  const matchesQuery = useQuery({
    ...matchesOptions,
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
  const selectedIsOnCurrentPage = selectedOnCurrentPage !== undefined;
  const shouldResolveHeldEvent =
    scope === "heldEvent" && Boolean(selectedId) && !selectedIsOnCurrentPage;
  const shouldResolveMatch = scope === "match" && Boolean(selectedId) && !selectedIsOnCurrentPage;

  const heldEventSummaryQuery = useQuery(
    heldEventSummaryQueryOptions(
      scope === "heldEvent" ? selectedId : undefined,
      shouldResolveHeldEvent,
    ),
  );
  const matchIdentityQuery = useQuery(
    matchIdentityQueryOptions(scope === "match" ? selectedId : undefined, shouldResolveMatch),
  );
  const canonicalResolvedCandidate =
    selectedOnCurrentPage ??
    (scope === "heldEvent"
      ? candidateFromHeldEventSummary(heldEventSummaryQuery.data)
      : scope === "match"
        ? candidateFromMatchIdentity(matchIdentityQuery.data)
        : undefined);
  const selectedDetailQuery =
    scope === "heldEvent"
      ? heldEventSummaryQuery
      : scope === "match"
        ? matchIdentityQuery
        : undefined;
  const shouldResolveSelectedTarget = shouldResolveHeldEvent || shouldResolveMatch;
  const selectedDetailFailure =
    shouldResolveSelectedTarget && selectedDetailQuery && shouldShowQueryError(selectedDetailQuery)
      ? normalizeUnknownApiError(selectedDetailQuery.error).status === 404
        ? ("not-found" as const)
        : ("load-failed" as const)
      : null;
  const snapshotCandidate =
    selectionSnapshot?.scope === scope && selectionSnapshot.candidate.value === selectedId
      ? selectionSnapshot.candidate
      : undefined;
  const selected =
    scope === "season"
      ? {
          candidate: selectedOnCurrentPage,
          state:
            selectedId && !selectedIsOnCurrentPage ? ("not-found" as const) : ("resolved" as const),
        }
      : resolveExportCandidate({
          canonicalCandidate: canonicalResolvedCandidate,
          detailFailure: selectedDetailFailure,
          detailFetching: selectedDetailQuery?.isFetching === true,
          selectedId,
          shouldResolve: shouldResolveSelectedTarget,
          snapshotCandidate,
        });
  const resolvedCandidate = selected.candidate;
  const selectedResolution = useRetryNotice(
    selected.state,
    selectedDetailQuery?.isFetching === true,
    `${scope}:${selectedId}`,
  );
  const hasResolvedTarget = Boolean(selectedId && resolvedCandidate?.value === selectedId);
  const scopeChanging =
    scope === "heldEvent"
      ? Boolean(heldEventsQuery.isPlaceholderData && heldEventsQuery.isFetching)
      : scope === "match"
        ? Boolean(matchesQuery.isPlaceholderData && matchesQuery.isFetching)
        : false;
  const pagination =
    scope === "heldEvent"
      ? heldEventsQuery.data?.pagination
      : scope === "match"
        ? matchesQuery.data?.pagination
        : undefined;
  const loading =
    scope === "season"
      ? seasonsQuery.isLoading
      : scope === "heldEvent"
        ? heldEventsQuery.isLoading && !hasResolvedTarget
        : scope === "match"
          ? !hasResolvedTarget && matchesQuery.isLoading
          : false;
  const refreshing =
    scope === "season"
      ? seasonsQuery.isFetching && !seasonsQuery.isLoading
      : scope === "heldEvent"
        ? heldEventsQuery.isFetching && (!heldEventsQuery.isLoading || hasResolvedTarget)
        : scope === "match"
          ? matchesQuery.isFetching && (!matchesQuery.isLoading || hasResolvedTarget)
          : false;
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
  const selectedDetailRefreshFailed = Boolean(
    selectedDetailFailure === "load-failed" && resolvedCandidate?.value === selectedId,
  );
  const directoryError =
    scope === "season"
      ? seasonError
      : scope === "heldEvent"
        ? heldEventError
        : scope === "match"
          ? matchError
          : false;
  const hasCurrentDirectoryData =
    scope === "season"
      ? seasonsQuery.data !== undefined
      : scope === "heldEvent"
        ? hasCurrentHeldEventData
        : scope === "match"
          ? hasCurrentMatchData
          : true;
  const error = directoryError && !hasCurrentDirectoryData && !hasResolvedTarget;
  const supportIssue = buildCandidateSupportIssue({
    directoryBlocking: error,
    directoryError,
    hasCurrentDirectoryData,
    selectedTargetRefreshFailed: selectedDetailRefreshFailed,
  });
  const view = buildCandidateView({
    candidates,
    error,
    loading: loading && !error,
    pagination,
    resolvedCandidate,
    selectedResolution,
    scope,
    selectedId,
    supportIssue,
  });

  const reset = () => {
    setHeldEventPage(1);
    setMatchCursor("");
    setSelectionSnapshot(null);
  };
  const rememberCurrentSelection = () => {
    if (resolvedCandidate?.value === selectedId) {
      setSelectionSnapshot({ candidate: resolvedCandidate, scope });
    }
  };

  return {
    refreshing:
      refreshing ||
      (loading && error) ||
      Boolean(selectedDetailQuery?.isFetching && selectedResolution === "load-failed"),
    reset,
    scopeChanging,
    selectCandidate: (nextSelectedId: string) => {
      if (refreshing) return false;
      const candidate = candidates.find((item) => item.value === nextSelectedId);
      if (candidate) setSelectionSnapshot({ candidate, scope });
      return true;
    },
    setPage: (page: number) => {
      if (refreshing || page < 1) return;
      rememberCurrentSelection();
      if (scope === "heldEvent") setHeldEventPage(page);
      if (scope === "match" && matchesQuery.data) {
        const cursor = cursorForPage(matchesQuery.data.pagination, page);
        if (cursor !== undefined) setMatchCursor(cursor);
      }
    },
    retry: () => {
      rememberCurrentSelection();
      if (scope === "season") void seasonsQuery.refetch();
      if (scope === "heldEvent") {
        void heldEventsQuery.refetch();
        if (shouldResolveHeldEvent && shouldShowQueryError(heldEventSummaryQuery)) {
          void heldEventSummaryQuery.refetch();
        }
      }
      if (scope === "match") {
        void matchesQuery.refetch();
        if (shouldResolveMatch && shouldShowQueryError(matchIdentityQuery)) {
          void matchIdentityQuery.refetch();
        }
      }
    },
    retrySelectedCandidate: () => {
      if (shouldResolveHeldEvent) void heldEventSummaryQuery.refetch();
      if (shouldResolveMatch) void matchIdentityQuery.refetch();
    },
    view,
  };
}
