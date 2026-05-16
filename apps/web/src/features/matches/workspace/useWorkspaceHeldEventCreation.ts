import { useMutation, useQueryClient } from "@tanstack/react-query";

import { syncHeldEventCreatedCache } from "@/shared/api/heldEventCache";
import { createHeldEvent } from "@/shared/api/heldEvents";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

export function useWorkspaceHeldEventCreation(args: {
  onError: (message: string) => void;
  onSelectCreatedEvent: (event: HeldEventResponse) => void;
  onSuccessNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();

  return useMutation({
    mutationFn: async (request: Parameters<typeof createHeldEvent>[0]) => {
      return runIdempotentMutation(
        idempotencyKeys,
        "matchWorkspace.createHeldEvent",
        request,
        (options) => createHeldEvent(request, options),
      );
    },
    onSuccess: async (event) => {
      await syncHeldEventCreatedCache(queryClient, "workspace", event);
      args.onSelectCreatedEvent(event);
      args.onSuccessNotice(
        `開催履歴（${new Date(event.heldAt).toLocaleString()}）を作成して選択しました。`,
      );
    },
    onError: (error) => {
      args.onError(formatApiError(error, "開催履歴の作成に失敗しました"));
    },
  });
}
