import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { confirmMatch } from "@/features/draftReview/api";
import { updateMatch } from "@/features/matches/api";
import {
  invalidateMatchCaches,
  invalidateMatchDetailCaches,
} from "@/features/matches/queryKeys";
import { cancelMatchDraft } from "@/features/matches/workspace/api";
import { toUpdateMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { formatApiError } from "@/shared/api/problemDetails";
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

  const confirmMutation = useMutation({
    mutationFn: confirmMatch,
    onSuccess: async (response) => {
      await invalidateMatchCaches(queryClient);
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
      return updateMatch(matchId, toUpdateMatchRequest(values));
    },
    onSuccess: async (response) => {
      assertDefined(matchId, "matchId");
      await invalidateMatchDetailCaches(queryClient, matchId);
      navigate(`/matches/${encodeURIComponent(response.matchId)}`);
    },
    onError: (error) => {
      onError(formatApiError(error, "更新に失敗しました"));
    },
  });

  const cancelDraftMutation = useMutation({
    mutationFn: (draftId: string) => cancelMatchDraft(draftId),
    onSuccess: async () => {
      await invalidateMatchCaches(queryClient);
      navigate("/matches", { replace: true });
    },
    onError: (error) => {
      onError(formatApiError(error, "下書きの削除に失敗しました"));
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
