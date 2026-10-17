import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";

import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/matchWorkspacePanelViews";
import { syncHeldEventCreatedCache } from "@/shared/api/heldEventCache";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { createHeldEvent } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { formatDateTimeLong } from "@/shared/lib/dateTime";

type WorkspaceHeldEventCreation = {
  create: (request: Parameters<typeof createHeldEvent>[0]) => void;
  pending: boolean;
};

function useHeldEventCreationWrite({
  started,
  saved,
  failed,
}: {
  started: () => void;
  saved: (event: HeldEventResponse) => void;
  failed: (error: unknown) => void;
}): WorkspaceHeldEventCreation {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const creation = useMutation({
    onMutate: started,
    mutationFn: (request: Parameters<typeof createHeldEvent>[0]) =>
      runIdempotentMutation(idempotencyKeys, "matchWorkspace.createHeldEvent", request, (options) =>
        createHeldEvent(request, options),
      ),
    onSuccess: async (event) => {
      await syncHeldEventCreatedCache(queryClient, event);
      saved(event);
    },
    onError: failed,
  });
  return { create: creation.mutate, pending: creation.isPending };
}

/** Owns selection and feedback when the workspace creates a held event. */
export function useWorkspaceHeldEventCreation({
  onCreated,
  notify,
  setOperationError,
}: {
  onCreated: (event: HeldEventResponse) => void;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  setOperationError: (error: MatchWorkspaceOperationError | null) => void;
}): WorkspaceHeldEventCreation {
  const activeRef = useRef(true);
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  return useHeldEventCreationWrite({
    started: () => {
      notify("");
      setOperationError(null);
    },
    saved: (event) => {
      if (!activeRef.current) return;
      onCreated(event);
      notify(`開催（${formatDateTimeLong(event.heldAt)}）を作成して選択しました。`, "success");
    },
    failed: (error) => {
      if (!activeRef.current) return;
      setOperationError({
        kind: "heldEventCreation",
        message: formatApiError(error, "開催の作成に失敗しました"),
      });
    },
  });
}
