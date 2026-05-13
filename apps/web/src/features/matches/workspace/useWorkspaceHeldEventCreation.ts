import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createHeldEvent } from "@/shared/api/heldEvents";
import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

function upsertHeldEventList(
  current: HeldEventListResponse | undefined,
  event: HeldEventResponse,
): HeldEventListResponse {
  const existingItems = current?.items ?? [];
  const withoutDuplicate = existingItems.filter((item) => item.id !== event.id);
  return {
    items: [event, ...withoutDuplicate].toSorted(
      (left, right) =>
        new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime() ||
        right.id.localeCompare(left.id),
    ),
  };
}

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
    onSuccess: (event) => {
      queryClient.setQueryData<HeldEventListResponse>(heldEventKeys.scope("workspace"), (current) =>
        upsertHeldEventList(current, event),
      );
      void queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
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
