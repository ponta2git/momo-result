import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import type { MatchFormAction } from "@/features/matches/workspace/matchFormReducer";
import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/useWorkspaceNotice";
import { syncHeldEventCreatedCache } from "@/shared/api/heldEventCache";
import { createHeldEvent } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { formatDateTimeLong } from "@/shared/lib/dateTime";

/** Owns the complete held-event creation workflow used by the match workspace. */
export function useWorkspaceHeldEventCreation({
  dispatch,
  notify,
  setOperationError,
}: {
  dispatch: Dispatch<MatchFormAction>;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  setOperationError: Dispatch<SetStateAction<MatchWorkspaceOperationError | null>>;
}) {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();

  return useMutation({
    onMutate: () => setOperationError(null),
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
      dispatch({
        patch: {
          heldEventId: event.id,
          matchNoInEvent: event.nextMatchNo,
          playedAt: event.heldAt,
        },
        type: "patch_root",
      });
      notify(`開催（${formatDateTimeLong(event.heldAt)}）を作成して選択しました。`, "success");
    },
    onError: (error) => {
      setOperationError({
        kind: "heldEventCreation",
        message: formatApiError(error, "開催の作成に失敗しました"),
      });
    },
  });
}
