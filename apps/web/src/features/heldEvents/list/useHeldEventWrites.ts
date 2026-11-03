import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { syncHeldEventDeletedCache } from "@/shared/api/heldEventCache";
import { deleteHeldEvent } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

/** Deletion's cache reconciliation survives the dialog and completes before it is reported done. */
export function useHeldEventWrites(onRemoved: () => void) {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const { isPending: removing, mutateAsync } = useMutation({
    mutationFn: (heldEventId: string) =>
      runIdempotentMutation(
        idempotencyKeys,
        "heldEvents.deleteHeldEvent",
        { heldEventId },
        (options) => deleteHeldEvent(heldEventId, options),
      ),
    onSuccess: async (_response, heldEventId) => {
      await syncHeldEventDeletedCache(queryClient, heldEventId);
      onRemoved();
    },
  });
  const remove = useCallback(
    async (heldEventId: string) => {
      await mutateAsync(heldEventId);
    },
    [mutateAsync],
  );
  return { removing, remove };
}
