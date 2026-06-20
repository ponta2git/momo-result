import { useCallback, useTransition } from "react";
import { useNavigate } from "react-router-dom";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { prepareMatchWorkspaceMasterHandoffRoute } from "@/shared/workflows/matchWorkspaceMasterHandoff";

export function useMatchWorkspaceHandoffNavigation(input: {
  handoffSessionId: string;
  notify: (message: string, tone?: "info" | "success" | "warning") => void;
  returnTo: string | undefined;
  values: MatchFormValues;
}) {
  const navigate = useNavigate();
  const [isPending, startMastersTransition] = useTransition();
  const { handoffSessionId, notify, returnTo, values } = input;

  const navigateToMasters = useCallback(() => {
    if (!returnTo) {
      return;
    }
    const route = prepareMatchWorkspaceMasterHandoffRoute({
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
    startMastersTransition(() => {
      navigate(route.route);
    });
  }, [handoffSessionId, navigate, notify, returnTo, startMastersTransition, values]);

  return { isPending, navigateToMasters };
}
