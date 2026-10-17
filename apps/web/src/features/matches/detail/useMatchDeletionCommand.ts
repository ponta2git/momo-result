import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { MatchDeletionModel } from "@/features/matches/detail/matchDetailPageModel";
import {
  evictDeletedMatchDetail,
  invalidateAfterMatchDeleted,
} from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { deleteMatch } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { showToast } from "@/shared/ui/feedback/Toast";

type MatchDeletionCommand = {
  destination: string;
  targetMatchId: string;
};

type MatchDeletionCommandOptions = {
  heldEventId: string | undefined;
  matchId: string;
};

/** Owns deletion state, route ownership, and the post-delete cache/navigation transaction. */
export function useMatchDeletionCommand(options: MatchDeletionCommandOptions): MatchDeletionModel {
  const { matchId } = options;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const mountedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const destination = options.heldEventId
    ? `/held-events/${encodeURIComponent(options.heldEventId)}`
    : "/matches";

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
    onError: (error) => {
      if (mountedRef.current) setErrorMessage(formatApiError(error, "削除に失敗しました"));
    },
    onSuccess: async (_response, command) => {
      const invalidation = invalidateAfterMatchDeleted(queryClient, command.targetMatchId);
      if (mountedRef.current) {
        showToast({ title: "試合を削除しました", tone: "success" });
        navigate(command.destination, { flushSync: true, replace: true });
      }
      evictDeletedMatchDetail(queryClient, command.targetMatchId);
      await invalidation;
    },
  });

  const confirm = useCallback(async () => {
    setErrorMessage(null);
    await mutateAsync({ destination, targetMatchId: matchId });
  }, [destination, matchId, mutateAsync]);

  return { confirm, errorMessage, open, pending, setOpen };
}
