import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { toUpdateMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import {
  invalidateAfterDraftCancelled,
  invalidateAfterMatchConfirmed,
  invalidateAfterMatchUpdated,
} from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { cancelMatchDraft } from "@/shared/api/matchDrafts";
import { confirmMatch, updateMatch } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { assertDefined } from "@/shared/lib/invariant";

export type MatchWorkspaceMutationsParams = {
  matchId: string | undefined;
  onConfirmSuccess: () => void;
  onError: (message: string) => void;
};

/**
 * confirm / update / cancel の 3 つの副作用を持つ操作を集約する。
 * 各 onSuccess は冪等なキャッシュ無効化のみを実行し、
 * 成功時のナビゲーションも内部で完結させる。
 */
export function useMatchWorkspaceMutations({
  matchId,
  onConfirmSuccess,
  onError,
}: MatchWorkspaceMutationsParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();

  const confirmMutation = useMutation({
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
      navigate(`/matches/${encodeURIComponent(response.matchId)}`);
    },
    onError: (error) => {
      onError(formatApiError(error, "確定に失敗しました"));
    },
  });

  const updateMutation = useMutation({
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
      navigate(`/matches/${encodeURIComponent(response.matchId)}`);
    },
    onError: (error) => {
      onError(formatApiError(error, "更新に失敗しました"));
    },
  });

  const cancelDraftMutation = useMutation({
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
      navigate("/matches", { replace: true });
    },
    onError: (error) => {
      onError(formatApiError(error, "確定前の記録を削除できませんでした"));
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
