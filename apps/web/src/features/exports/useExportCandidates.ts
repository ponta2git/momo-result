import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  candidateFromHeldEventDetail,
  candidateFromMatchDetail,
  toHeldEventCandidates,
  toMatchCandidates,
  toSeasonCandidates,
} from "@/features/exports/exportCandidateData";
import type { ExportCandidate, ExportScope } from "@/features/exports/exportTypes";
import { buildCandidateView } from "@/features/exports/exportViewModel";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDetailQueryOptions,
  heldEventsQueryOptions,
  matchExportCandidatesQueryOptions,
  matchDetailQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";

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
  const [heldEventPage, setHeldEventPage] = useState(1);
  const [matchPage, setMatchPage] = useState(1);
  const [rememberedCandidate, setRememberedCandidate] = useState<RememberedCandidate | undefined>();

  const seasonsQuery = useQuery(
    seasonMastersQueryOptions("exports", undefined, scope === "season" || scope === "match"),
  );
  const gameTitlesQuery = useQuery({
    ...gameTitlesQueryOptions("exports"),
    enabled: scope === "match",
  });
  const heldEventsQuery = useQuery({
    ...heldEventsQueryOptions({ page: heldEventPage, pageSize: CANDIDATE_PAGE_SIZE }),
    enabled: scope === "heldEvent",
  });
  const matchesQuery = useQuery({
    ...matchExportCandidatesQueryOptions({
      kind: "match",
      page: matchPage,
      pageSize: CANDIDATE_PAGE_SIZE,
      sort: "held_desc",
      status: "confirmed",
    }),
    enabled: scope === "match",
  });

  const seasons = seasonsQuery.data?.items ?? [];
  const gameTitles = gameTitlesQuery.data?.items ?? [];
  const candidates =
    scope === "season"
      ? toSeasonCandidates(seasons)
      : scope === "heldEvent"
        ? toHeldEventCandidates(heldEventsQuery.data?.items ?? [])
        : scope === "match"
          ? toMatchCandidates(matchesQuery.data?.items ?? [], gameTitles, seasons)
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
        ? heldEventsQuery.isLoading
        : scope === "match"
          ? seasonsQuery.isLoading || gameTitlesQuery.isLoading || matchesQuery.isLoading
          : false;
  const refreshing =
    scope === "season"
      ? seasonsQuery.isFetching && !seasonsQuery.isLoading
      : scope === "heldEvent"
        ? (heldEventsQuery.isFetching && !heldEventsQuery.isLoading) ||
          heldEventDetailQuery.isFetching
        : scope === "match"
          ? [seasonsQuery, gameTitlesQuery, matchesQuery].some(
              (query) => query.isFetching && !query.isLoading,
            ) || matchDetailQuery.isFetching
          : false;
  const error =
    scope === "season"
      ? shouldShowQueryError(seasonsQuery)
      : scope === "heldEvent"
        ? shouldShowQueryError(heldEventsQuery)
        : scope === "match"
          ? [seasonsQuery, gameTitlesQuery, matchesQuery].some(shouldShowQueryError)
          : false;
  const view = buildCandidateView({
    candidates,
    error,
    loading,
    pagination,
    resolvedCandidate,
    resolvingSelected: shouldResolveHeldEvent
      ? heldEventDetailQuery.isFetching
      : shouldResolveMatch
        ? matchDetailQuery.isFetching
        : false,
    scope,
    selectedId,
  });

  const reset = () => {
    setHeldEventPage(1);
    setMatchPage(1);
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
      if (scope === "match") setMatchPage(page);
    },
    retry: () => {
      if (scope === "season") void seasonsQuery.refetch();
      if (scope === "heldEvent") {
        void heldEventsQuery.refetch();
        if (shouldResolveHeldEvent) void heldEventDetailQuery.refetch();
      }
      if (scope === "match") {
        void Promise.all([
          seasonsQuery.refetch(),
          gameTitlesQuery.refetch(),
          matchesQuery.refetch(),
        ]);
        if (shouldResolveMatch) void matchDetailQuery.refetch();
      }
    },
    view,
  };
}
