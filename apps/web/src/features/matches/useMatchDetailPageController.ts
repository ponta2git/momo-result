import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  nextMatchDetailSort,
  rankMatchDetailPlayers,
  sortMatchDetailPlayers,
} from "@/features/matches/matchDetailViewModel";
import type {
  MatchDetailSortKey,
  MatchDetailSortState,
} from "@/features/matches/matchDetailViewModel";
import { invalidateAfterMatchDeleted } from "@/shared/api/cacheInvalidation";
import { listHeldEvents } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { deleteMatch, getMatch } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys, masterKeys, matchKeys } from "@/shared/api/queryKeys";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

export function useMatchDetailPageController() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sort, setSort] = useState<MatchDetailSortState>({
    key: "playOrder",
    direction: "asc",
  });

  const matchQuery = useQuery({
    enabled: matchId.trim().length > 0,
    queryFn: ({ signal }) => getMatch(matchId, { signal }),
    queryKey: matchKeys.detail(matchId),
  });

  const heldEventsQuery = useQuery({
    queryFn: ({ signal }) => listHeldEvents("", 100, { signal }),
    queryKey: heldEventKeys.scope("all"),
  });
  const gameTitlesQuery = useQuery({
    queryFn: ({ signal }) => listGameTitles({ signal }),
    queryKey: masterKeys.gameTitles.list("match-detail"),
  });
  const seasonsQuery = useQuery({
    queryFn: ({ signal }) => listSeasonMasters(undefined, { signal }),
    queryKey: masterKeys.seasonMasters.list("match-detail"),
  });
  const mapsQuery = useQuery({
    queryFn: ({ signal }) => listMapMasters(undefined, { signal }),
    queryKey: masterKeys.mapMasters.list("match-detail"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const payload = { matchId };
      return runIdempotentMutation(idempotencyKeys, "matchDetail.deleteMatch", payload, (options) =>
        deleteMatch(matchId, options),
      );
    },
    onError: (error) => {
      setErrorMessage(formatApiError(error, "削除に失敗しました"));
    },
    onSuccess: async () => {
      await invalidateAfterMatchDeleted(queryClient);
      navigate("/matches", { replace: true });
    },
  });

  const match = matchQuery.data;
  const heldEvent = match
    ? (heldEventsQuery.data?.items ?? []).find((event) => event.id === match.heldEventId)
    : undefined;
  const gameTitle = match
    ? (gameTitlesQuery.data?.items ?? []).find((item) => item.id === match.gameTitleId)
    : undefined;
  const season = match
    ? (seasonsQuery.data?.items ?? []).find((item) => item.id === match.seasonMasterId)
    : undefined;
  const map = match
    ? (mapsQuery.data?.items ?? []).find((item) => item.id === match.mapMasterId)
    : undefined;
  const heldAt = heldEvent?.heldAt ?? match?.playedAt ?? "";
  const sourcePlayers = useMemo(() => match?.players ?? [], [match?.players]);
  const players = useMemo(() => sortMatchDetailPlayers(sourcePlayers, sort), [sourcePlayers, sort]);
  const rankedPlayers = useMemo(() => rankMatchDetailPlayers(sourcePlayers), [sourcePlayers]);

  const setSortKey = (key: MatchDetailSortKey) => {
    setSort((current) => nextMatchDetailSort(current, key));
  };

  const confirmDelete = async () => {
    setErrorMessage(null);
    await deleteMutation.mutateAsync();
  };

  const detailLoading =
    isInitialQueryLoading(matchQuery) ||
    isInitialQueryLoading(heldEventsQuery) ||
    isInitialQueryLoading(gameTitlesQuery) ||
    isInitialQueryLoading(seasonsQuery) ||
    isInitialQueryLoading(mapsQuery);
  const detailLoadFailed =
    matchId.trim().length === 0 ||
    shouldShowBlockingQueryError(matchQuery) ||
    shouldShowBlockingQueryError(heldEventsQuery) ||
    shouldShowBlockingQueryError(gameTitlesQuery) ||
    shouldShowBlockingQueryError(seasonsQuery) ||
    shouldShowBlockingQueryError(mapsQuery);

  if (detailLoading) {
    return { status: "loading" as const };
  }

  if (detailLoadFailed || !match) {
    return { status: "loadFailed" as const };
  }

  return {
    confirmDelete,
    errorMessage,
    gameTitle,
    heldAt,
    isDeletePending: deleteMutation.isPending,
    map,
    match,
    players,
    rankedPlayers,
    season,
    setShowConfirm,
    setSortKey,
    showConfirm,
    sort,
    status: "ready" as const,
  };
}
