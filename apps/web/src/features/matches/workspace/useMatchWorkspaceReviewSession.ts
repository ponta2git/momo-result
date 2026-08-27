import { useCallback } from "react";
import type { Dispatch } from "react";

import type { MatchFormAction } from "@/features/matches/workspace/matchFormReducer";
import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceSessionDraft } from "@/features/matches/workspace/matchWorkspaceSessionDraft";
import { useMatchWorkspaceReviewState } from "@/features/matches/workspace/useMatchWorkspaceReviewState";
import { useMatchWorkspaceSessionDraft } from "@/features/matches/workspace/useMatchWorkspaceSessionDraft";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/useWorkspaceNotice";

export function useMatchWorkspaceReviewSession({
  accountId,
  confirmedDraftLoaded,
  dispatch,
  isInitialized,
  mode,
  notify,
  reviewKey,
  values,
  workspaceData,
}: {
  accountId: string | undefined;
  confirmedDraftLoaded: boolean;
  dispatch: Dispatch<MatchFormAction>;
  isInitialized: boolean;
  mode: WorkspaceMode;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  reviewKey: string;
  values: MatchFormValues;
  workspaceData: MatchWorkspaceInitialData | null;
}) {
  const reviewState = useMatchWorkspaceReviewState({ reviewKey, values, workspaceData });
  const { restoreAcknowledgedCellIds } = reviewState;
  const handleRestore = useCallback(
    (draft: MatchWorkspaceSessionDraft) => {
      dispatch({
        payload: {
          ...draft.values,
          ...(values.matchDraftId ? { matchDraftId: values.matchDraftId } : {}),
        },
        type: "replace",
      });
      restoreAcknowledgedCellIds(draft.acknowledgedCellIds);
      notify("一時保存した入力内容とOCR確認状況を復元しました。", "success");
    },
    [dispatch, notify, restoreAcknowledgedCellIds, values.matchDraftId],
  );
  const sessionDraft = useMatchWorkspaceSessionDraft({
    accountId,
    acknowledgedCellIds: reviewState.acknowledgedCellIds,
    enabled: isInitialized && !confirmedDraftLoaded,
    mode,
    onRestore: handleRestore,
    values,
    workspaceKey: reviewKey,
  });

  return { reviewState, sessionDraft };
}
