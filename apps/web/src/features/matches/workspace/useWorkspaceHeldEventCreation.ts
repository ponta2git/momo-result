import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createHeldEvent } from "@/shared/api/heldEvents";
import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { formatApiError } from "@/shared/api/problemDetails";
import { heldEventKeys } from "@/shared/api/queryKeys";

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

  return useMutation({
    mutationFn: (request: Parameters<typeof createHeldEvent>[0]) => createHeldEvent(request),
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
