import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { MatchDeletionControls } from "@/features/matches/detail/matchDetailView";
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

type MatchDeletionOptions = {
  heldEventId: string | undefined;
  matchId: string;
};

/** Invalidates before handing off navigation, then removes the deleted resource. */
function useMatchDeletionWrite({
  onDeleted,
  onFailure,
}: {
  onDeleted: (command: MatchDeletionCommand) => void;
  onFailure: (error: unknown) => void;
}): { pending: boolean; run: (command: MatchDeletionCommand) => Promise<void> } {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const { isPending: pending, mutateAsync } = useMutation({
    mutationFn: async ({ targetMatchId }: MatchDeletionCommand) => {
      const payload = { matchId: targetMatchId };
      return runIdempotentMutation(idempotencyKeys, "matchDetail.deleteMatch", payload, (request) =>
        deleteMatch(targetMatchId, request),
      );
    },
    onError: onFailure,
    onSuccess: async (_response, command) => {
      const invalidation = invalidateAfterMatchDeleted(queryClient, command.targetMatchId);
      onDeleted(command);
      evictDeletedMatchDetail(queryClient, command.targetMatchId);
      await invalidation;
    },
  });
  const run = useCallback(
    async (command: MatchDeletionCommand) => {
      await mutateAsync(command);
    },
    [mutateAsync],
  );
  return { pending, run };
}

/** Owns deletion confirmation, route ownership, and completion feedback. */
export function useMatchDeletion(options: MatchDeletionOptions): MatchDeletionControls {
  const { matchId } = options;
  const navigate = useNavigate();
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

  const { pending, run } = useMatchDeletionWrite({
    onFailure: (error) => {
      if (mountedRef.current) setErrorMessage(formatApiError(error, "削除に失敗しました"));
    },
    onDeleted: (command) => {
      if (mountedRef.current) {
        showToast({ title: "試合を削除しました", tone: "success" });
        navigate(command.destination, { flushSync: true, replace: true });
      }
    },
  });

  const confirm = useCallback(async () => {
    setErrorMessage(null);
    await run({ destination, targetMatchId: matchId });
  }, [destination, matchId, run]);

  return { confirm, errorMessage, open, pending, setOpen };
}
