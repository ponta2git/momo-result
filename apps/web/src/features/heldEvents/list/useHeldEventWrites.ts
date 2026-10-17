import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { syncHeldEventCreatedCache, syncHeldEventDeletedCache } from "@/shared/api/heldEventCache";
import { createHeldEvent, deleteHeldEvent } from "@/shared/api/heldEvents";
import type { CreateHeldEventRequest } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

/** Cache reconciliation survives the dialog and completes before a write is reported as done. */
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
  return {
    removing,
    remove,
    create: async (request: CreateHeldEventRequest) => {
      const event = await runIdempotentMutation(
        idempotencyKeys,
        "heldEvents.createHeldEvent",
        request,
        (options) => createHeldEvent(request, options),
      );
      await syncHeldEventCreatedCache(queryClient, event);
      return event;
    },
  };
}
