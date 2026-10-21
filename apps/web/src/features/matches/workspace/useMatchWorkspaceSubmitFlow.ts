import { useActionState, useCallback, useLayoutEffect, useRef, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import type { NavigateOptions } from "react-router-dom";

import {
  toConfirmMatchRequest,
  toUpdateMatchRequest,
} from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/matchWorkspacePanelViews";
import { useConfirmedDraftRedirect } from "@/features/matches/workspace/useConfirmedDraftRedirect";
import { useMatchWorkspaceWrites } from "@/features/matches/workspace/useMatchWorkspaceWrites";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { heldEventDetailHref, matchDetailHref } from "@/shared/navigation/publicIdentifiers";
import { showToast } from "@/shared/ui/feedback/Toast";

function isConflict(error: unknown): boolean {
  const normalized = normalizeUnknownApiError(error);
  return normalized.status === 409 || normalized.code === "CONFLICT";
}

/** Owns confirmation, conflict recovery and navigation after Writes reconciles a saved result. */
export function useMatchWorkspaceSubmitFlow({
  matchId,
  matchPublicId,
  heldEventPublicId,
  notify,
  onPersistedSuccess,
  setConfirmOpen,
  setOperationError,
  setValidationMessage,
  values,
  readLatestValues,
}: {
  matchId: string | undefined;
  matchPublicId?: string | undefined;
  heldEventPublicId?: string | undefined;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  onPersistedSuccess: () => void;
  setConfirmOpen: (open: boolean) => void;
  setOperationError: (error: MatchWorkspaceOperationError | null) => void;
  setValidationMessage: (message: string) => void;
  values: Pick<MatchFormValues, "heldEventId" | "matchDraftId">;
  readLatestValues: () => MatchFormValues;
}) {
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
  const confirmedDraft = useConfirmedDraftRedirect({
    notify,
    onBeforeRedirect: onPersistedSuccess,
  });
  const writes = useMatchWorkspaceWrites({
    started: () => setOperationError(null),
    saved: (result) => {
      if (!activeRef.current) return;
      if (result.kind === "cancelDraft") {
        showToast({ title: "確定前の記録を削除しました", tone: "success" });
        onPersistedSuccess();
        navigateAfterSuccess(
          values.heldEventId
            ? heldEventDetailHref(values.heldEventId, heldEventPublicId)
            : "/matches",
          { replace: true },
        );
        return;
      }
      showToast({
        title: result.kind === "confirm" ? "試合を確定しました" : "試合を保存しました",
        tone: "success",
      });
      if (result.kind === "confirm") setConfirmOpen(false);
      onPersistedSuccess();
      navigateAfterSuccess(
        matchDetailHref(result.matchId, result.kind === "update" ? matchPublicId : undefined),
      );
    },
    failed: async (failure) => {
      if (!activeRef.current) return;
      if (failure.kind === "confirm" && failure.draftId && isConflict(failure.error)) {
        const handled = await confirmedDraft.handleConfirmConflict(failure.draftId);
        if (handled || !activeRef.current) return;
      }
      const fallback = {
        confirm: "確定に失敗しました",
        update: "更新に失敗しました",
        cancelDraft: "確定前の記録を削除できませんでした",
      }[failure.kind];
      if (failure.kind === "confirm") setConfirmOpen(false);
      setOperationError({ kind: failure.kind, message: formatApiError(failure.error, fallback) });
    },
  });
  const { confirm, cancelDraft, update: updateMatch } = writes;
  const [, confirmAction, confirmationPending] = useActionState<null, FormData>(async () => {
    const request = toConfirmMatchRequest(readLatestValues());
    await confirm(request).catch(() => undefined);
    return null;
  }, null);
  const saveChanges = useCallback(
    (latestValues: MatchFormValues) => updateMatch(matchId, toUpdateMatchRequest(latestValues)),
    [matchId, updateMatch],
  );
  const cancelDraftConfirmed = useCallback(async () => {
    if (!values.matchDraftId) {
      return;
    }
    setOperationError(null);
    setValidationMessage("");
    await cancelDraft(values.matchDraftId);
  }, [cancelDraft, setOperationError, setValidationMessage, values.matchDraftId]);

  return {
    cancelDraftConfirmed,
    cancelDraftPending: writes.cancelDraftPending,
    confirmation: { action: confirmAction, pending: confirmationPending },
    confirmedDraft,
    pending: isNavigating || writes.pending,
    saveChanges,
  };
}
