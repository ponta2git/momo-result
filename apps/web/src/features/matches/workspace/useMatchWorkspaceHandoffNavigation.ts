import { useCallback, useTransition } from "react";
import { useNavigate } from "react-router-dom";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { prepareMatchWorkspaceMasterHandoffRoute } from "@/shared/workflows/matchWorkspaceMasterHandoff";

export function useMatchWorkspaceHandoffNavigation(input: {
  matchDraftId: string | undefined;
  matchSessionId: string | undefined;
  mode: WorkspaceMode;
  notify: (message: string, tone?: "info" | "success" | "warning") => void;
  returnTo: string | undefined;
  values: MatchFormValues;
}) {
  const navigate = useNavigate();
  const [, startMastersTransition] = useTransition();
  const { matchDraftId, matchSessionId, mode, notify, returnTo, values } = input;

  return useCallback(() => {
    if (!returnTo) {
      return;
    }
    const route = prepareMatchWorkspaceMasterHandoffRoute({
      matchSessionId: matchSessionId ?? matchDraftId ?? mode,
      returnTo,
      values,
    });
    if (route.status !== "available") {
      notify(
        "入力内容を保持する準備ができなかったため、設定管理へ移動しませんでした。もう一度お試しください。",
        "warning",
      );
      return;
    }
    startMastersTransition(() => {
      navigate(route.route);
    });
  }, [
    matchDraftId,
    matchSessionId,
    mode,
    navigate,
    notify,
    returnTo,
    startMastersTransition,
    values,
  ]);
}
