import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { MatchDeletionModel } from "@/features/matches/matchDetailPageModel";
import {
  evictDeletedMatchDetail,
  invalidateAfterMatchDeleted,
} from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { deleteMatch } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

type MatchDeletionCommand = {
  destination: string;
  targetMatchId: string;
};

type MatchDeletionCommandOptions = {
  contextualReturnTo: string | undefined;
  heldEventId: string | undefined;
  matchId: string;
  pathname: string;
};

function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

function deletionDestination({
  contextualReturnTo,
  heldEventId,
  pathname,
}: MatchDeletionCommandOptions): string {
  const pointsToCurrentDetail =
    contextualReturnTo !== undefined &&
    normalizePathname(new URL(contextualReturnTo, "https://momo-result.local").pathname) ===
      normalizePathname(pathname);
  if (contextualReturnTo && !pointsToCurrentDetail) return contextualReturnTo;
  return heldEventId ? `/held-events/${encodeURIComponent(heldEventId)}` : "/matches";
}

/** Owns deletion state, route ownership, and the post-delete cache/navigation transaction. */
export function useMatchDeletionCommand(options: MatchDeletionCommandOptions): MatchDeletionModel {
  const { matchId } = options;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const mountedRef = useRef(false);
  const latestMatchIdRef = useRef(matchId);
  latestMatchIdRef.current = matchId;
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const destination = deletionDestination(options);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { isPending: pending, mutateAsync } = useMutation({
    mutationFn: async ({ targetMatchId }: MatchDeletionCommand) => {
      const payload = { matchId: targetMatchId };
      return runIdempotentMutation(idempotencyKeys, "matchDetail.deleteMatch", payload, (request) =>
        deleteMatch(targetMatchId, request),
      );
    },
    onError: (error, { targetMatchId }) => {
      if (!mountedRef.current || latestMatchIdRef.current !== targetMatchId) return;
      setErrorMessage(formatApiError(error, "削除に失敗しました"));
    },
    onSuccess: async (_response, { destination: confirmedDestination, targetMatchId }) => {
      const ownsDeletedDetail = mountedRef.current && latestMatchIdRef.current === targetMatchId;
      const invalidation = invalidateAfterMatchDeleted(queryClient);
      if (ownsDeletedDetail) {
        navigate(confirmedDestination, { flushSync: true, replace: true });
      }
      evictDeletedMatchDetail(queryClient, targetMatchId);
      await invalidation;
    },
  });

  const confirm = useCallback(async () => {
    setErrorMessage(null);
    await mutateAsync({ destination, targetMatchId: matchId });
  }, [destination, matchId, mutateAsync]);

  return { confirm, errorMessage, open, pending, setOpen };
}
