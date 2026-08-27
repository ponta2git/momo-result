import { useCallback } from "react";
import type { Dispatch } from "react";

import type { MatchFormAction } from "@/features/matches/workspace/matchFormReducer";
import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { useMasterHandoffRestore } from "@/features/matches/workspace/useMasterHandoffRestore";
import { useMatchWorkspaceHandoffNavigation } from "@/features/matches/workspace/useMatchWorkspaceHandoffNavigation";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/useWorkspaceNotice";
import type { MasterHandoffPayload } from "@/shared/workflows/matchWorkspaceMasterHandoff";

export type MatchWorkspaceMasterHandoffParams = {
  accountId: string | undefined;
  dispatch: Dispatch<MatchFormAction>;
  handoffSessionId: string;
  isInitialized: boolean;
  mode: WorkspaceMode;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  onBeforeNavigate: () => void;
  searchParams: URLSearchParams;
  values: MatchFormValues;
};

export type MatchWorkspaceMasterHandoff = {
  isPending: boolean;
  navigateToMasters: () => void;
  returnAvailable: boolean;
};

/** Owns account-scoped master handoff restoration and navigation as one workflow boundary. */
export function useMatchWorkspaceMasterHandoff({
  accountId,
  dispatch,
  handoffSessionId,
  isInitialized,
  mode,
  notify,
  onBeforeNavigate,
  searchParams,
  values,
}: MatchWorkspaceMasterHandoffParams): MatchWorkspaceMasterHandoff {
  const restore = useCallback(
    (payload: MasterHandoffPayload) => {
      dispatch({
        payload: {
          ...payload.values,
          ...(values.matchDraftId ? { matchDraftId: values.matchDraftId } : {}),
        },
        type: "replace",
      });
      notify("設定管理から戻ったため、入力内容を復元しました。", "success");
    },
    [dispatch, notify, values.matchDraftId],
  );
  const reportRestoreFailure = useCallback(
    () => notify("設定管理から戻りましたが、入力内容を復元できませんでした。", "warning"),
    [notify],
  );
  const { returnTo } = useMasterHandoffRestore({
    accountId,
    handoffSessionId,
    isInitialized,
    mode,
    onRestore: restore,
    onRestoreFailed: reportRestoreFailure,
    searchParams,
  });
  const navigation = useMatchWorkspaceHandoffNavigation({
    accountId,
    handoffSessionId,
    notify,
    onBeforeNavigate,
    returnTo,
    values,
  });

  return {
    isPending: navigation.isPending,
    navigateToMasters: navigation.navigateToMasters,
    returnAvailable: (mode === "review" || mode === "create") && Boolean(returnTo),
  };
}
