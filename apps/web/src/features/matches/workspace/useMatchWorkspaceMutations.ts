import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { toUpdateMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceOperationErrorKind } from "@/features/matches/workspace/matchWorkspaceOperationError";
import {
  invalidateAfterDraftCancelled,
  invalidateAfterMatchConfirmed,
  invalidateAfterMatchUpdated,
} from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { cancelMatchDraft } from "@/shared/api/matchDrafts";
import { confirmMatch, updateMatch } from "@/shared/api/matches";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { assertDefined } from "@/shared/lib/invariant";
import { withReturnTo } from "@/shared/navigation/returnTo";

export type MatchWorkspaceMutationsParams = {
  heldEventId: string;
  matchId: string | undefined;
  mode: "create" | "edit" | "review";
  onConfirmConflict?: (matchDraftId: string) => Promise<boolean>;
  onConfirmSuccess: () => void;
  onError: (kind: MatchWorkspaceOperationErrorKind, message: string) => void;
  onOperationStart: (kind: MatchWorkspaceOperationErrorKind) => void;
  onPersistedSuccess: () => void;
  returnTo?: string | undefined;
};

function isConflict(error: unknown): boolean {
  const normalized = normalizeUnknownApiError(error);
  return normalized.status === 409 || normalized.code === "CONFLICT";
}

/**
 * confirm / update / cancel の 3 つの副作用を持つ操作を集約する。
 * 各 onSuccess は冪等なキャッシュ無効化のみを実行し、
 * 成功時のナビゲーションも内部で完結させる。
 */
export function useMatchWorkspaceMutations({
  heldEventId,
  matchId,
  mode,
  onConfirmConflict,
  onConfirmSuccess,
  onError,
  onOperationStart,
  onPersistedSuccess,
  returnTo,
}: MatchWorkspaceMutationsParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();

  const confirmMutation = useMutation({
    onMutate: () => onOperationStart("confirm"),
    mutationFn: async (request: Parameters<typeof confirmMatch>[0]) => {
      return runIdempotentMutation(
        idempotencyKeys,
        "matchWorkspace.confirmMatch",
        request,
        (options) => confirmMatch(request, options),
      );
    },
    onSuccess: async (response) => {
      await invalidateAfterMatchConfirmed(queryClient);
      onConfirmSuccess();
      onPersistedSuccess();
      navigate(matchSuccessDestination(response.matchId, mode, returnTo));
    },
    onError: async (error, request) => {
      if (request.matchDraftId && isConflict(error)) {
        const handled = await onConfirmConflict?.(request.matchDraftId);
        if (handled) {
          return;
        }
      }
      onError("confirm", formatApiError(error, "確定に失敗しました"));
    },
  });

  const updateMutation = useMutation({
    onMutate: () => onOperationStart("update"),
    mutationFn: (values: MatchFormValues) => {
      assertDefined(matchId, "matchId");
      const request = toUpdateMatchRequest(values);
      const payload = { matchId, request };
      return runIdempotentMutation(
        idempotencyKeys,
        "matchWorkspace.updateMatch",
        payload,
        (options) => updateMatch(matchId, request, options),
      );
    },
    onSuccess: async (response) => {
      assertDefined(matchId, "matchId");
      await invalidateAfterMatchUpdated(queryClient, matchId);
      onPersistedSuccess();
      navigate(matchSuccessDestination(response.matchId, mode, returnTo));
    },
    onError: (error) => {
      onError("update", formatApiError(error, "更新に失敗しました"));
    },
  });

  const cancelDraftMutation = useMutation({
    onMutate: () => onOperationStart("cancelDraft"),
    mutationFn: async (draftId: string) => {
      const payload = { draftId };
      return runIdempotentMutation(
        idempotencyKeys,
        "matchWorkspace.cancelMatchDraft",
        payload,
        (options) => cancelMatchDraft(draftId, options),
      );
    },
    onSuccess: async () => {
      await invalidateAfterDraftCancelled(queryClient);
      onPersistedSuccess();
      navigate(
        returnTo ?? (heldEventId ? `/held-events/${encodeURIComponent(heldEventId)}` : "/matches"),
        { replace: true },
      );
    },
    onError: (error) => {
      onError("cancelDraft", formatApiError(error, "確定前の記録を削除できませんでした"));
    },
  });

  const isMutating =
    confirmMutation.isPending || updateMutation.isPending || cancelDraftMutation.isPending;

  return {
    cancelDraftMutation,
    confirmMutation,
    isMutating,
    updateMutation,
  };
}

function matchSuccessDestination(
  matchId: string,
  mode: "create" | "edit" | "review",
  returnTo: string | undefined,
): string {
  const detailPath = `/matches/${encodeURIComponent(matchId)}`;
  if (mode === "edit" && returnTo) {
    const parsed = new URL(returnTo, "https://momo-result.local");
    if (parsed.pathname === detailPath) {
      return returnTo;
    }
  }
  return withReturnTo(detailPath, returnTo);
}
