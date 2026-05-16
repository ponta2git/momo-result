import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
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

  const matchQuery = useSuspenseQuery({
    queryFn: () => getMatch(matchId),
    queryKey: matchKeys.detail(matchId),
  });

  const heldEventsQuery = useSuspenseQuery({
    queryFn: () => listHeldEvents("", 100),
    queryKey: heldEventKeys.scope("all"),
  });
  const gameTitlesQuery = useSuspenseQuery({
    queryFn: () => listGameTitles(),
    queryKey: masterKeys.gameTitles.list("match-detail"),
  });
  const seasonsQuery = useSuspenseQuery({
    queryFn: () => listSeasonMasters(),
    queryKey: masterKeys.seasonMasters.list("match-detail"),
  });
  const mapsQuery = useSuspenseQuery({
    queryFn: () => listMapMasters(),
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
  const heldEvent = (heldEventsQuery.data?.items ?? []).find(
    (event) => event.id === match.heldEventId,
  );
  const gameTitle = (gameTitlesQuery.data?.items ?? []).find(
    (item) => item.id === match.gameTitleId,
  );
  const season = (seasonsQuery.data?.items ?? []).find((item) => item.id === match.seasonMasterId);
  const map = (mapsQuery.data?.items ?? []).find((item) => item.id === match.mapMasterId);
  const heldAt = heldEvent?.heldAt ?? match.playedAt;
  const sourcePlayers = useMemo(() => match.players ?? [], [match.players]);
  const players = useMemo(() => sortMatchDetailPlayers(sourcePlayers, sort), [sourcePlayers, sort]);
  const rankedPlayers = useMemo(() => rankMatchDetailPlayers(sourcePlayers), [sourcePlayers]);

  const setSortKey = (key: MatchDetailSortKey) => {
    setSort((current) => nextMatchDetailSort(current, key));
  };

  const confirmDelete = async () => {
    setErrorMessage(null);
    await deleteMutation.mutateAsync();
  };

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
  };
}
