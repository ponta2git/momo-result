import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  candidateFromHeldEventDetail,
  candidateFromMatchDetail,
  toHeldEventCandidates,
  toMatchCandidates,
  toSeasonCandidates,
} from "@/features/exports/exportCandidateData";
import type { ExportCandidate, ExportScope } from "@/features/exports/exportTypes";
import { buildCandidateSupportIssue, buildCandidateView } from "@/features/exports/exportViewModel";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDetailQueryOptions,
  heldEventsQueryOptions,
  matchExportCandidatesQueryOptions,
  matchDetailQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { cursorForPage } from "@/shared/lib/cursorPagination";

const CANDIDATE_PAGE_SIZE = 20;

type RememberedCandidate = {
  candidate: ExportCandidate;
  scope: Extract<ExportScope, "heldEvent" | "match">;
};

export function useExportCandidates({
  scope,
  selectedId,
}: {
  scope: ExportScope;
  selectedId: string;
}) {
  const queryClient = useQueryClient();
  const [heldEventPage, setHeldEventPage] = useState(1);
  const [matchCursor, setMatchCursor] = useState("");
  const [rememberedCandidate, setRememberedCandidate] = useState<RememberedCandidate | undefined>();

  const seasonsQuery = useQuery(
    seasonMastersQueryOptions("exports", undefined, scope === "season" || scope === "match"),
  );
  const gameTitlesQuery = useQuery({
    ...gameTitlesQueryOptions("exports"),
    enabled: scope === "match",
  });
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
    queryClient.getQueryData(heldEventsOptions.queryKey) !== undefined;
  const hasCurrentMatchData = queryClient.getQueryData(matchesOptions.queryKey) !== undefined;
  const seasons = seasonsQuery.data?.items ?? [];
  const gameTitles = gameTitlesQuery.data?.items ?? [];
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
          ? toMatchCandidates(matches, gameTitles, seasons)
          : [];
  const rememberedSelection =
    rememberedCandidate?.scope === scope && rememberedCandidate.candidate.value === selectedId
      ? rememberedCandidate.candidate
      : undefined;
  const selectedIsOnCurrentPage = candidates.some((candidate) => candidate.value === selectedId);
  const shouldResolveHeldEvent =
    scope === "heldEvent" &&
    Boolean(selectedId) &&
    !selectedIsOnCurrentPage &&
    !rememberedSelection;
  const shouldResolveMatch =
    scope === "match" && Boolean(selectedId) && !selectedIsOnCurrentPage && !rememberedSelection;

  const heldEventDetailQuery = useQuery(
    heldEventDetailQueryOptions(
      scope === "heldEvent" ? selectedId : undefined,
      shouldResolveHeldEvent,
    ),
  );
  const matchDetailQuery = useQuery(
    matchDetailQueryOptions(scope === "match" ? selectedId : undefined, shouldResolveMatch),
  );
  const resolvedCandidate =
    rememberedSelection ??
    (scope === "heldEvent"
      ? candidateFromHeldEventDetail(heldEventDetailQuery.data)
      : scope === "match"
        ? candidateFromMatchDetail(matchDetailQuery.data, gameTitles, seasons)
        : undefined);
  const selectedDetailQuery =
    scope === "heldEvent" ? heldEventDetailQuery : scope === "match" ? matchDetailQuery : undefined;
  const selectedResolution = (() => {
    if (scope === "season") {
      return selectedId && !selectedIsOnCurrentPage
        ? ("not-found" as const)
        : ("resolved" as const);
    }
    if (!shouldResolveHeldEvent && !shouldResolveMatch) {
      return "resolved" as const;
    }
    if (resolvedCandidate?.value === selectedId) {
      return "resolved" as const;
    }
    if (selectedDetailQuery?.isFetching) {
      return "resolving" as const;
    }
    if (selectedDetailQuery && shouldShowQueryError(selectedDetailQuery)) {
      return normalizeUnknownApiError(selectedDetailQuery.error).status === 404
        ? ("not-found" as const)
        : ("load-failed" as const);
    }
    return "resolving" as const;
  })();
  const hasResolvedTarget = Boolean(selectedId && resolvedCandidate?.value === selectedId);
  const pagination =
    scope === "heldEvent"
      ? hasCurrentHeldEventData
        ? heldEventsQuery.data?.pagination
        : undefined
      : scope === "match"
        ? hasCurrentMatchData
          ? matchesQuery.data?.pagination
          : undefined
        : undefined;
  const loading =
    scope === "season"
      ? seasonsQuery.isLoading
      : scope === "heldEvent"
        ? heldEventsQuery.isLoading && !hasResolvedTarget
        : scope === "match"
          ? !hasResolvedTarget &&
            (seasonsQuery.isLoading || gameTitlesQuery.isLoading || matchesQuery.isLoading)
          : false;
  const refreshing =
    scope === "season"
      ? seasonsQuery.isFetching && !seasonsQuery.isLoading
      : scope === "heldEvent"
        ? (heldEventsQuery.isFetching && (!heldEventsQuery.isLoading || hasResolvedTarget)) ||
          heldEventDetailQuery.isFetching
        : scope === "match"
          ? [seasonsQuery, gameTitlesQuery, matchesQuery].some(
              (query) => query.isFetching && (!query.isLoading || hasResolvedTarget),
            ) || matchDetailQuery.isFetching
          : false;
  const seasonError = shouldShowQueryError(seasonsQuery);
  const gameTitleError = shouldShowQueryError(gameTitlesQuery);
  const heldEventError = shouldShowQueryError(heldEventsQuery);
  const matchError = shouldShowQueryError(matchesQuery);
  const selectedDetailRefreshFailed = Boolean(
    selectedDetailQuery &&
    shouldShowQueryError(selectedDetailQuery) &&
    resolvedCandidate?.value === selectedId,
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
  const referencesGameTitle =
    scope === "match" &&
    (Boolean(matchDetailQuery.data?.gameTitleId) ||
      matches.some(
        (match) =>
          match.kind === "match" && match.status === "confirmed" && Boolean(match.gameTitleId),
      ));
  const referencesSeason =
    scope === "match" &&
    (Boolean(matchDetailQuery.data?.seasonMasterId) ||
      matches.some(
        (match) =>
          match.kind === "match" && match.status === "confirmed" && Boolean(match.seasonMasterId),
      ));
  const relevantGameTitleError = gameTitleError && referencesGameTitle;
  const relevantSeasonError = seasonError && referencesSeason;
  const supportIssue = buildCandidateSupportIssue({
    directoryBlocking: error,
    directoryError,
    hasCurrentDirectoryData,
    namesError: relevantGameTitleError || relevantSeasonError,
    namesLoadFailed:
      (relevantGameTitleError && gameTitlesQuery.data === undefined) ||
      (relevantSeasonError && seasonsQuery.data === undefined),
    selectedTargetRefreshFailed: selectedDetailRefreshFailed,
  });
  const view = buildCandidateView({
    candidates,
    error,
    loading,
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
    setRememberedCandidate(undefined);
  };

  return {
    refreshing,
    reset,
    selectCandidate: (nextSelectedId: string): boolean => {
      if (refreshing) return false;
      const nextCandidate = candidates.find((candidate) => candidate.value === nextSelectedId);
      if (nextCandidate && (scope === "heldEvent" || scope === "match")) {
        setRememberedCandidate({ candidate: nextCandidate, scope });
      }
      return true;
    },
    setPage: (page: number) => {
      if (refreshing || page < 1) return;
      if (scope === "heldEvent" || scope === "match") {
        const currentCandidate =
          candidates.find((candidate) => candidate.value === selectedId) ?? resolvedCandidate;
        if (currentCandidate) setRememberedCandidate({ candidate: currentCandidate, scope });
      }
      if (scope === "heldEvent") setHeldEventPage(page);
      if (scope === "match" && matchesQuery.data) {
        const cursor = cursorForPage(matchesQuery.data.pagination, page);
        if (cursor !== undefined) setMatchCursor(cursor);
      }
    },
    retry: () => {
      if (scope === "season") void seasonsQuery.refetch();
      if (scope === "heldEvent") {
        void heldEventsQuery.refetch();
        if (shouldResolveHeldEvent && shouldShowQueryError(heldEventDetailQuery)) {
          void heldEventDetailQuery.refetch();
        }
      }
      if (scope === "match") {
        void Promise.all([
          seasonsQuery.refetch(),
          gameTitlesQuery.refetch(),
          matchesQuery.refetch(),
        ]);
        if (shouldResolveMatch && shouldShowQueryError(matchDetailQuery)) {
          void matchDetailQuery.refetch();
        }
      }
    },
    retrySelectedCandidate: () => {
      if (shouldResolveHeldEvent) void heldEventDetailQuery.refetch();
      if (shouldResolveMatch) void matchDetailQuery.refetch();
    },
    view,
  };
}
