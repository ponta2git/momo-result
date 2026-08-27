import { useCallback, useTransition } from "react";
import { useNavigate } from "react-router-dom";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { prepareMatchWorkspaceMasterHandoffRoute } from "@/shared/workflows/matchWorkspaceMasterHandoff";

export function useMatchWorkspaceHandoffNavigation(input: {
  accountId: string | undefined;
  handoffSessionId: string;
  notify: (message: string, tone?: "info" | "success" | "warning") => void;
  onBeforeNavigate?: () => void;
  returnTo: string | undefined;
  values: MatchFormValues;
}) {
  const navigate = useNavigate();
  const [isPending, startMastersTransition] = useTransition();
  const { accountId, handoffSessionId, notify, onBeforeNavigate, returnTo, values } = input;

  const navigateToMasters = useCallback(() => {
    if (!accountId || !returnTo) {
      return;
    }
    const route = prepareMatchWorkspaceMasterHandoffRoute({
      accountId,
      matchSessionId: handoffSessionId,
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
    onBeforeNavigate?.();
    startMastersTransition(() => {
      navigate(route.route);
    });
  }, [
    accountId,
    handoffSessionId,
    navigate,
    notify,
    onBeforeNavigate,
    returnTo,
    startMastersTransition,
    values,
  ]);

  return { isPending, navigateToMasters };
}
