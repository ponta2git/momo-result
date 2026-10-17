import { useCallback, useLayoutEffect, useRef, useTransition } from "react";
import type { NavigateOptions } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import { toUpdateMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceOperationErrorKind } from "@/features/matches/workspace/matchWorkspaceOperationError";
import { useMatchWorkspaceWrites } from "@/features/matches/workspace/useMatchWorkspaceWrites";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { showToast } from "@/shared/ui/feedback/Toast";

export type MatchWorkspaceMutationsParams = {
  heldEventId: string;
  matchId: string | undefined;
  onConfirmConflict?: (matchDraftId: string) => Promise<boolean>;
  onConfirmSuccess: () => void;
  onError: (kind: MatchWorkspaceOperationErrorKind, message: string) => void;
  onOperationStart: (kind: MatchWorkspaceOperationErrorKind) => void;
  onPersistedSuccess: () => void;
};

function isConflict(error: unknown): boolean {
  const normalized = normalizeUnknownApiError(error);
  return normalized.status === 409 || normalized.code === "CONFLICT";
}

/** Owns conflict recovery, completion feedback, and navigation for workspace writes. */
export function useMatchWorkspaceMutations({
  heldEventId,
  matchId,
  onConfirmConflict,
  onConfirmSuccess,
  onError,
  onOperationStart,
  onPersistedSuccess,
}: MatchWorkspaceMutationsParams) {
  const navigate = useNavigate();
  const activeRef = useRef(true);
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const [isNavigating, startNavigation] = useTransition();
  const navigateAfterSuccess = (destination: string, options?: NavigateOptions) => {
    startNavigation(async () => {
      await navigate(destination, options);
    });
  };
  const writes = useMatchWorkspaceWrites({
    started: onOperationStart,
    saved: (result) => {
      if (!activeRef.current) return;
      if (result.kind === "cancelDraft") {
        showToast({ title: "確定前の記録を削除しました", tone: "success" });
        onPersistedSuccess();
        navigateAfterSuccess(
          heldEventId ? `/held-events/${encodeURIComponent(heldEventId)}` : "/matches",
          { replace: true },
        );
        return;
      }
      showToast({
        title: result.kind === "confirm" ? "試合を確定しました" : "試合を保存しました",
        tone: "success",
      });
      if (result.kind === "confirm") onConfirmSuccess();
      onPersistedSuccess();
      navigateAfterSuccess(`/matches/${encodeURIComponent(result.matchId)}`);
    },
    failed: async (failure) => {
      if (!activeRef.current) return;
      if (failure.kind === "confirm" && failure.draftId && isConflict(failure.error)) {
        const handled = await onConfirmConflict?.(failure.draftId);
        if (handled || !activeRef.current) return;
      }
      const fallback = {
        confirm: "確定に失敗しました",
        update: "更新に失敗しました",
        cancelDraft: "確定前の記録を削除できませんでした",
      }[failure.kind];
      onError(failure.kind, formatApiError(failure.error, fallback));
    },
  });
  const { update: updateMatch } = writes;
  const update = useCallback(
    (values: MatchFormValues) => updateMatch(matchId, toUpdateMatchRequest(values)),
    [matchId, updateMatch],
  );
  return {
    cancelDraft: writes.cancelDraft,
    cancelDraftPending: writes.cancelDraftPending,
    confirm: writes.confirm,
    pending: isNavigating || writes.pending,
    update,
  };
}
